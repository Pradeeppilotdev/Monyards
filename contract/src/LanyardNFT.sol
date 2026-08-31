// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LanyardNFT
/// @notice ERC-721 that stores an immutable, fully off-chain personalized
///         tokenURI per mint. The contract itself does no rendering: every
///         mint's tokenURI points to pinned metadata whose `animation_url` is a
///         self-contained HTML page (the interactive Lanyard). The name, X
///         handle and PFP are baked into that HTML before the mint is broadcast.
contract LanyardNFT is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 private _nextTokenId;

    uint256 public mintPrice;
    uint256 public maxSupply;
    bool public mintEnabled;

    /// @notice Per-wallet mint cap. 0 = unlimited.
    uint256 public perWalletCap;
    mapping(address => uint256) public mintCount;

    /// @notice Collection-level metadata URI (pinned JSON). Marketplaces read
    ///         this for the collection name/description/banner — without it
    ///         collection pages render blank.
    string public contractURI;

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event PerWalletCapUpdated(uint256 newCap);

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
    /// @return tokenId The newly minted token id.
    function mint(string calldata uri) external payable nonReentrant returns (uint256) {
        require(mintEnabled, "mint not enabled");
        require(_nextTokenId < maxSupply, "max supply reached");
        require(msg.value >= mintPrice, "insufficient payment");
        require(perWalletCap == 0 || mintCount[msg.sender] < perWalletCap, "per-wallet limit reached");

        uint256 tokenId = _nextTokenId++;
        mintCount[msg.sender]++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);

        emit Minted(msg.sender, tokenId, uri);
        return tokenId;
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    function setMintPrice(uint256 mintPrice_) external onlyOwner {
        mintPrice = mintPrice_;
    }

    function setMintEnabled(bool enabled) external onlyOwner {
        mintEnabled = enabled;
    }

    function setPerWalletCap(uint256 cap) external onlyOwner {
        perWalletCap = cap;
        emit PerWalletCapUpdated(cap);
    }

    /// @notice Set the collection-level metadata URI.
    function setContractURI(string calldata uri) external onlyOwner {
        contractURI = uri;
    }

    /// @notice Repair/replace a token's metadata URI (e.g. a mint whose pin
    ///         failed before real IPFS pinning was configured).
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "token does not exist");
        _setTokenURI(tokenId, uri);
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool ok,) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    receive() external payable {}

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
