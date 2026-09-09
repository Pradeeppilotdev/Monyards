// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {LanyardNFT} from "../src/LanyardNFT.sol";

contract LanyardNFTReferralTest is Test, IERC721Receiver {
    LanyardNFT public nft;
    string constant TOKEN_URI = "ipfs://bafybeig...metadata.json";

    address REF = address(0x1111);
    address FAN = address(0x2222);

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}

    function mintAs(address who) internal {
        vm.deal(who, 1 ether);
        vm.prank(who);
        nft.mint{value: 0.01 ether}(TOKEN_URI, address(0));
    }

    function setUp() public {
        nft = new LanyardNFT(0.01 ether, 20);
        nft.setMintEnabled(true);
        nft.setReferralBps(1000); // 10%
    }

    function test_NoReferrerRecordsNoAttribution() public {
        vm.deal(address(this), 1 ether);
        uint256 tokenId = nft.mint{value: 0.01 ether}(TOKEN_URI, address(0));
        assertEq(nft.referrerOf(tokenId), address(0));
        assertEq(nft.referralBalance(address(this)), 0);
    }

    function test_SelfReferReverts() public {
        vm.expectRevert("cannot self-refer");
        nft.mint{value: 0.01 ether}(TOKEN_URI, address(this));
    }

    function test_NonHolderReferrerReverts() public {
        vm.deal(REF, 1 ether);
        vm.prank(REF);
        vm.expectRevert("referrer must hold a lanyard");
        nft.mint{value: 0.01 ether}(TOKEN_URI, FAN); // FAN hasn't minted yet
    }

    function test_ReferralAccruesToHolder() public {
        mintAs(REF); // REF is now a holder

        vm.deal(FAN, 1 ether);
        vm.prank(FAN);
        uint256 tokenId = nft.mint{value: 0.01 ether}(TOKEN_URI, REF);

        assertEq(nft.referrerOf(tokenId), REF);
        // 10% of 0.01 ether.
        assertEq(nft.referralBalance(REF), 0.001 ether);
        assertEq(nft.referralBalance(FAN), 0);
    }

    function test_ReferralAccruesEvenWhenFeeZero() public {
        nft.setReferralBps(0);
        mintAs(REF);
        vm.deal(FAN, 1 ether);
        vm.prank(FAN);
        uint256 tokenId = nft.mint{value: 0.01 ether}(TOKEN_URI, REF);
        // Attribution recorded even when mintPrice * bps is 0.
        assertEq(nft.referrerOf(tokenId), REF);
        assertEq(nft.referralBalance(REF), 0);
    }

    function test_ClaimTransfersAndZeroesBalance() public {
        mintAs(REF);
        vm.deal(FAN, 1 ether);
        vm.prank(FAN);
        nft.mint{value: 0.01 ether}(TOKEN_URI, REF);

        uint256 before = REF.balance;
        vm.prank(REF);
        uint256 claimed = nft.claimReferralFees();
        assertEq(claimed, 0.001 ether);
        assertEq(REF.balance, before + 0.001 ether);
        assertEq(nft.referralBalance(REF), 0);
    }

    function test_ClaimNothingReverts() public {
        vm.expectRevert("nothing to claim");
        nft.claimReferralFees();
    }

    function test_DesignerRoyaltyPaidToCreator() public {
        nft.setRoyaltyBps(500); // 5%
        mintAs(REF); // REF minted token 0 -> they are its designer
        (address receiver, uint256 amount) = nft.royaltyInfo(0, 1 ether);
        assertEq(receiver, REF);
        assertEq(amount, 0.05 ether);
    }

    function test_DefaultRoyaltyIsZero() public {
        mintAs(REF);
        (address receiver, uint256 amount) = nft.royaltyInfo(0, 1 ether);
        assertEq(receiver, REF);
        assertEq(amount, 0);
    }

    function test_SetterRoyalty() public {
        nft.setRoyaltyBps(500); // 5%
        mintAs(REF);
        (address receiver, uint256 amount) = nft.royaltyInfo(0, 1 ether);
        assertEq(receiver, REF);
        assertEq(amount, 0.05 ether);
    }

    function test_SetterRoyaltyBpsCap() public {
        vm.expectRevert("royalty bps too high");
        nft.setRoyaltyBps(2500);
    }

    function test_SetterReferralBpsCap() public {
        vm.expectRevert("referral bps too high");
        nft.setReferralBps(4000);
    }

    function test_ReferralBpsOnlyOwner() public {
        vm.prank(address(0xbeef));
        vm.expectRevert();
        nft.setReferralBps(500);
    }

    function test_SupportsERC2981() public {
        assertTrue(nft.supportsInterface(0x2a55205a)); // IERC2981
    }
}