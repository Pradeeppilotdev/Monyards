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
        // One mint per wallet — use distinct wallets to fill the supply.
        for (uint256 i = 0; i < 10; i++) {
            address w = address(uint160(0x1000 + i));
            vm.deal(w, 1 ether);
            vm.prank(w);
            nft.mint{value: 0 ether}(TOKEN_URI);
        }
        vm.prank(address(0x2000));
        vm.expectRevert("max supply reached");
        nft.mint(TOKEN_URI);
        assertEq(nft.totalSupply(), 10);
    }

    function test_OneMintPerWallet() public {
        address minter = address(0xb0b);
        nft.mint(TOKEN_URI);
        vm.prank(minter);
        nft.mint(TOKEN_URI);
        // Same wallet mints twice -> rejected.
        vm.prank(minter);
        vm.expectRevert("already minted");
        nft.mint(TOKEN_URI);
        assertEq(nft.mintCount(minter), 1);
    }

    function test_TransferOwnershipDoesNotEnableRemint() public {
        address minter = address(0xb0b);
        address buddy = address(0xcc);
        nft.mint(TOKEN_URI); // minted by address(this)
        vm.prank(buddy);
        nft.mint(TOKEN_URI); // buddy mints theirs

        // buddy transfers their token away -> balance 0, but mintCount stays.
        vm.prank(buddy);
        nft.transferFrom(buddy, minter, 1);
        assertEq(nft.balanceOf(buddy), 0);
        assertEq(nft.mintCount(buddy), 1);

        // buddy should NOT be able to re-mint.
        vm.prank(buddy);
        vm.expectRevert("already minted");
        nft.mint(TOKEN_URI);
    }

    function test_OnlyOwnerCannotBypassCap() public {
        nft.setMintPrice(0 ether);
        nft.mint(TOKEN_URI); // owner mints once
        // Even the owner cannot mint a second time.
        vm.expectRevert("already minted");
        nft.mint(TOKEN_URI);
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

    function test_RefundsOverpayment() public {
        nft.setMintPrice(0.01 ether);
        address minter = address(0xb0b);
        vm.deal(minter, 1 ether);
        uint256 before = minter.balance;
        // Mintee pays 0.05, cost 0.01 -> 0.04 refunded, net cost 0.01.
        vm.prank(minter);
        nft.mint{value: 0.05 ether}(TOKEN_URI);
        assertEq(minter.balance, before - 0.01 ether);
        assertEq(nft.balanceOf(minter), 1);
    }

    function test_RefundUsesNoExtraBalance() public {
        // Sender pays exactly price; any pre-existing contract balance stays.
        // Foundry pre-funds this test contract, so track the delta from the
        // contract instead of absolute balances.
        nft.setMintPrice(0.01 ether);
        uint256 contractBefore = address(nft).balance;
        uint256 senderBefore = address(this).balance;
        nft.mint{value: 0.01 ether}(TOKEN_URI);
        // Contract keeps exactly the mint price (0.01).
        assertEq(address(nft).balance, contractBefore + 0.01 ether);
        // Sender only loses the 0.01 price (no extra withdrawal).
        assertEq(address(this).balance, senderBefore - 0.01 ether);
    }

    function test_RejectsEmptyUri() public {
        vm.expectRevert("invalid uri length");
        nft.mint("");
    }

    function test_RejectsOversizedUri() public {
        string memory big = new string(2049);
        vm.expectRevert("invalid uri length");
        nft.mint(big);
    }

    function test_TwoStepOwnershipTransfer() public {
        address next = address(0xabcd);
        nft.transferOwnership(next);
        assertEq(nft.pendingOwner(), next);
        assertEq(nft.owner(), address(this));

        vm.prank(next);
        nft.acceptOwnership();
        assertEq(nft.owner(), next);

        // Old owner can no longer mint-control.
        vm.prank(address(this));
        vm.expectRevert();
        nft.setMintEnabled(false);
    }
}