// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LanyardNFT
/// @notice ERC-721 that stores an immutable, fully off-chain personalized
///         tokenURI per mint. The contract itself does no rendering: every
///         mint's tokenURI points to pinned metadata whose `animation_url` is a
///         self-contained HTML page (the interactive Lanyard). The name, X
///         handle and PFP are baked into that HTML before the mint is broadcast.
///
/// Earning loops (hackathon "attention -> economic stake"):
///   - Referral: `mint` takes a `referrer` address. When a wallet that already
///     holds a Lanyard refers a new mint, `referralBps` of the mint price
///     accrues to them. Fees are pull-payments (`claimReferralFees`), never
///     pushed inside mint, so a malicious referrer contract can't grief mints.
///   - Designer royalty: every token's creator is recorded at mint and earns an
///     ERC2981 secondary-sale royalty when that card changes hands.
///
/// Security notes:
///   - Two-step ownership (Ownable2Step) — a mistaken transfer can always be
///     caught and reverted by the current owner before the new one accepts.
///   - ReentrancyGuard on mint(), claimReferralFees() and withdraw().
///   - Mint never pays referrers directly (accrual only) — no reentrancy.
///   - Excess mint payment is refunded to the sender.
///   - Strictly ONE mint per wallet, enforced on-chain and immutable — not even
///     the owner can relax it. Everyone gets exactly one Lanyard, ever.
contract LanyardNFT is ERC721, ERC721URIStorage, ERC2981, Ownable2Step, ReentrancyGuard {
    /// @dev Upper bound on a tokenURI so mints can't bloat state with absurd
    ///      payloads. IPFS/https URIs are well under this.
    uint256 public constant MAX_URI_LENGTH = 2048;

    /// @dev Caps on owner-settable percentages (basis points).
    uint256 public constant MAX_REFERRAL_BPS = 2500; // 25%
    uint256 public constant MAX_ROYALTY_BPS = 1000; // 10%

    uint256 private _nextTokenId;

    uint256 public mintPrice;
    /// @dev Total mintable tokens. Immutable — cannot be changed post-deploy.
    uint256 public immutable maxSupply;
    bool public mintEnabled;

    /// @dev Share of each mint's price paid to the referrer (basis points).
    uint256 public referralBps;
    /// @dev ERC2981 royalty paid on every secondary sale (basis points).
    uint96 public royaltyBps;

    /// @dev Total number of mints each wallet has performed, forever.
    ///      Never decremented — so transferring a Lanyard away still counts,
    ///      and a wallet can never mint a second one.
    mapping(address => uint256) public mintCount;

    /// @dev Attribution: which token was minted because of whom.
    mapping(uint256 => address) public referrerOf;

    /// @dev Pull-payment balances accrued to referrers.
    mapping(address => uint256) public referralBalance;

    /// @notice Collection-level metadata URI (pinned JSON). Marketplaces read
    ///         this for the collection name/description/banner — without it
    ///         collection pages render blank.
    string public contractURI;

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event Referred(address indexed referrer, address indexed referred, uint256 indexed tokenId, uint256 fee);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event MintEnabledUpdated(bool enabled);
    event ContractURIUpdated(string uri);
    event TokenURIUpdated(uint256 indexed tokenId, string uri);
    event ReferralBpsUpdated(uint256 oldBps, uint256 newBps);
    event RoyaltyBpsUpdated(uint256 oldBps, uint256 newBps);
    event ReferralFeesClaimed(address indexed claimer, uint256 amount);

    constructor(
        uint256 mintPrice_,
        uint256 maxSupply_
    ) ERC721("Monad Lanyard", "MLYD") Ownable(msg.sender) {
        mintPrice = mintPrice_;
        maxSupply = maxSupply_;
    }

    /// @notice Mint a personalized lanyard.
    /// @param uri Metadata URI (IPFS). Must be generated off-chain and
    ///         pinned before calling this — the contract does no validation of
    ///         its contents, only stores it.
    /// @param referrer Wallet whose Lanyard drove this mint. address(0) = no
    ///         referral. Must already hold a Lanyard and differ from caller.
    /// @return tokenId The newly minted token id.
    function mint(string calldata uri, address referrer) external payable nonReentrant returns (uint256) {
        require(mintEnabled, "mint not enabled");
        require(bytes(uri).length > 0 && bytes(uri).length <= MAX_URI_LENGTH, "invalid uri length");
        require(_nextTokenId < maxSupply, "max supply reached");
        require(msg.value >= mintPrice, "insufficient payment");
        // Exactly one Lanyard per wallet, forever. Immutable requirement —
        // tracked by mintCount so transferring one away can't enable a re-mint.
        require(mintCount[msg.sender] == 0, "already minted");
        // Referrals only count from real holders — prevents lazy address
        // farming and ties the incentive to actual graph growth.
        if (referrer != address(0)) {
            require(referrer != msg.sender, "cannot self-refer");
            require(mintCount[referrer] > 0, "referrer must hold a lanyard");
        }

        uint256 tokenId = _nextTokenId++;
        mintCount[msg.sender]++;
        // Refund any overpayment — don't leave stranded value in the contract.
        if (msg.value > mintPrice) {
            (bool ok,) = msg.sender.call{value: msg.value - mintPrice}("");
            require(ok, "refund failed");
        }

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        // Designer royalty: the wallet that created this specific card earns
        // on every secondary sale of it.
        _setTokenRoyalty(tokenId, msg.sender, royaltyBps);

        if (referrer != address(0)) {
            referrerOf[tokenId] = referrer;
            uint256 fee = (mintPrice * referralBps) / 10000;
            if (fee > 0) {
                referralBalance[referrer] += fee;
                emit Referred(referrer, msg.sender, tokenId, fee);
            } else {
                emit Referred(referrer, msg.sender, tokenId, 0);
            }
        }

        emit Minted(msg.sender, tokenId, uri);
        return tokenId;
    }

    /// @notice Pull accumulated referral fees. Never pushes during mint.
    function claimReferralFees() external nonReentrant returns (uint256) {
        uint256 amount = referralBalance[msg.sender];
        require(amount > 0, "nothing to claim");
        referralBalance[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "claim failed");
        emit ReferralFeesClaimed(msg.sender, amount);
        return amount;
    }

    /// @notice Designer royalty for a token on a given sale price.
    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view override returns (address, uint256) {
        return super.royaltyInfo(tokenId, salePrice);
    }

    /// @notice Minted token count. Always accurate — burning is not exposed.
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    function setMintPrice(uint256 mintPrice_) external onlyOwner {
        emit MintPriceUpdated(mintPrice, mintPrice_);
        mintPrice = mintPrice_;
    }

    function setMintEnabled(bool enabled) external onlyOwner {
        mintEnabled = enabled;
        emit MintEnabledUpdated(enabled);
    }

    function setReferralBps(uint256 referralBps_) external onlyOwner {
        require(referralBps_ <= MAX_REFERRAL_BPS, "referral bps too high");
        emit ReferralBpsUpdated(referralBps, referralBps_);
        referralBps = referralBps_;
    }

    function setRoyaltyBps(uint96 royaltyBps_) external onlyOwner {
        require(royaltyBps_ <= MAX_ROYALTY_BPS, "royalty bps too high");
        emit RoyaltyBpsUpdated(royaltyBps, royaltyBps_);
        royaltyBps = royaltyBps_;
    }

    function setContractURI(string calldata uri) external onlyOwner {
        contractURI = uri;
        emit ContractURIUpdated(uri);
    }

    /// @notice Repair/replace a token's metadata URI (e.g. a mint whose pin
    ///         failed before real IPFS pinning was configured).
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "token does not exist");
        _setTokenURI(tokenId, uri);
        emit TokenURIUpdated(tokenId, uri);
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool ok,) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    receive() external payable {}

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}