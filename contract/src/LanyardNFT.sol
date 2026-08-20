// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LanyardNFT
/// @notice ERC-721 that stores an immutable, fully off-chain personalized
///         tokenURI per mint. The contract itself does no rendering: every
///         mint's tokenURI points to pinned metadata whose `animation_url` is a
///         self-contained HTML page (the interactive Lanyard). The name, X
///         handle and PFP are baked into that HTML before the mint is broadcast.
contract LanyardNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    uint256 public mintPrice;
    uint256 public maxSupply;
    bool public mintEnabled;

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);

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
    function mint(string calldata uri) external payable returns (uint256) {
        require(mintEnabled, "mint not enabled");
        require(_nextTokenId < maxSupply, "max supply reached");
        require(msg.value >= mintPrice, "insufficient payment");

        uint256 tokenId = _nextTokenId++;
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

    function withdraw() external onlyOwner {
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