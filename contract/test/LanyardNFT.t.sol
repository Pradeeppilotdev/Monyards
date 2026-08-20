// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {LanyardNFT} from "../src/LanyardNFT.sol";

contract LanyardNFTTest is Test, IERC721Receiver {
    LanyardNFT public nft;
    string constant TOKEN_URI = "ipfs://bafybeig...metadata.json";

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}

    function setUp() public {
        nft = new LanyardNFT(0 ether, 10);
        nft.setMintEnabled(true);
    }

    function test_Mint() public {
        uint256 tokenId = nft.mint(TOKEN_URI);
        assertEq(tokenId, 0);
        assertEq(nft.ownerOf(0), address(this));
        assertEq(nft.tokenURI(0), TOKEN_URI);
        assertEq(nft.totalSupply(), 1);
    }

    function test_RespectsMaxSupply() public {
        for (uint256 i = 0; i < 10; i++) nft.mint(TOKEN_URI);
        vm.expectRevert("max supply reached");
        nft.mint(TOKEN_URI);
        assertEq(nft.totalSupply(), 10);
    }

    function test_MintDisabled() public {
        nft.setMintEnabled(false);
        vm.expectRevert("mint not enabled");
        nft.mint(TOKEN_URI);
    }

    function test_PaidMintRequiresPayment() public {
        nft.setMintPrice(0.01 ether);
        vm.expectRevert("insufficient payment");
        nft.mint(TOKEN_URI);
    }

    function test_PaidMintAcceptsExactPayment() public {
        nft.setMintPrice(0.01 ether);
        uint256 tokenId = nft.mint{value: 0.01 ether}(TOKEN_URI);
        assertEq(tokenId, 0);
    }

    function test_OnlyOwnerWithdraws() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(nft).call{value: 1 ether}("");
        require(ok, "fund failed");

        vm.prank(address(0xbeef));
        vm.expectRevert();
        nft.withdraw();

        uint256 before = address(this).balance;
        nft.withdraw();
        assertEq(address(this).balance, before + 1 ether);
        assertEq(address(nft).balance, 0);
    }

    function test_MintPriceOnlyOwner() public {
        vm.prank(address(0xbeef));
        vm.expectRevert();
        nft.setMintPrice(1 ether);

        nft.setMintPrice(1 ether);
        assertEq(nft.mintPrice(), 1 ether);
    }
}