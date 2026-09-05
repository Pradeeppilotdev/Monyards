// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {LanyardNFT} from "../src/LanyardNFT.sol";

contract DeployLanyardNFT is Script {
    function run() external returns (LanyardNFT nft) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 mintPrice = vm.envOr("MINT_PRICE", uint256(0));
        uint256 maxSupply = vm.envOr("MAX_SUPPLY", uint256(1000));

        vm.startBroadcast(deployerKey);
        nft = new LanyardNFT(mintPrice, maxSupply);
        nft.setMintEnabled(true);
        // Collection-level metadata (name/description/banner) — marketplaces
        // read contractURI() for the collection page. Pin a JSON like:
        // { "name": "Monad Lanyard", "description": "...", "image": "ipfs://..." }
        string memory contractUri = vm.envOr("CONTRACT_URI", string(""));
        if (bytes(contractUri).length > 0) nft.setContractURI(contractUri);
        vm.stopBroadcast();

        console.log("LanyardNFT deployed at", address(nft));
        console.log("mintPrice", mintPrice);
        console.log("maxSupply", maxSupply);
        // One-mint-per-wallet is a hardcoded, immutable contract invariant.
        console.log("perWalletCap", "1 (immutable)");
    }
}