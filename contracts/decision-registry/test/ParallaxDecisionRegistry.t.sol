// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ParallaxDecisionRegistry} from "../src/ParallaxDecisionRegistry.sol";

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address sender) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function expectRevert(bytes4 revertSelector) external;
    function expectPartialRevert(bytes4 revertSelector) external;
}

contract ParallaxDecisionRegistryTest {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ATTESTOR = address(0xA771);
    address private constant OTHER = address(0xB0B);
    bytes32 private constant RUN_KEY = keccak256("run-key");
    bytes32 private constant COMMITMENT = keccak256("commitment");
    bytes32 private constant UPDATED_COMMITMENT = keccak256("updated");

    ParallaxDecisionRegistry private registry;

    function setUp() public {
        registry = new ParallaxDecisionRegistry(ATTESTOR);
    }

    function testConstructorRejectsZeroAttestor() public {
        vm.expectRevert(ParallaxDecisionRegistry.InvalidAttestor.selector);
        new ParallaxDecisionRegistry(address(0));
    }

    function testOnlyAttestorCanAnchor() public {
        vm.expectPartialRevert(
            ParallaxDecisionRegistry.UnauthorizedAttestor.selector
        );
        vm.prank(OTHER);
        registry.anchorDecision(RUN_KEY, COMMITMENT);
    }

    function testRejectsZeroRunKeyAndCommitment() public {
        vm.expectRevert(ParallaxDecisionRegistry.InvalidRunKey.selector);
        vm.prank(ATTESTOR);
        registry.anchorDecision(bytes32(0), COMMITMENT);

        vm.expectRevert(ParallaxDecisionRegistry.InvalidCommitment.selector);
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, bytes32(0));
    }

    function testAnchorsOnceAndEmitsTheAttestor() public {
        vm.recordLogs();
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, COMMITMENT);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1, "expected one anchoring event");
        require(logs[0].emitter == address(registry), "wrong event emitter");
        require(
            logs[0].topics[0] ==
                keccak256("DecisionAnchored(bytes32,bytes32,address)"),
            "wrong event signature"
        );
        require(logs[0].topics[1] == RUN_KEY, "wrong run key");
        require(
            logs[0].topics[2] == bytes32(uint256(uint160(ATTESTOR))),
            "wrong attestor"
        );
        require(abi.decode(logs[0].data, (bytes32)) == COMMITMENT, "wrong hash");
        require(registry.commitmentOf(RUN_KEY) == COMMITMENT, "not stored");
    }

    function testSameCommitmentRetryIsIdempotentWithoutAnotherEvent() public {
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, COMMITMENT);

        vm.recordLogs();
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, COMMITMENT);

        require(vm.getRecordedLogs().length == 0, "retry emitted another event");
        require(registry.commitmentOf(RUN_KEY) == COMMITMENT, "retry changed hash");
    }

    function testRejectsReplacementOfAnAnchoredDecision() public {
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, COMMITMENT);

        vm.expectPartialRevert(
            ParallaxDecisionRegistry.DecisionAlreadyAnchored.selector
        );
        vm.prank(ATTESTOR);
        registry.anchorDecision(RUN_KEY, UPDATED_COMMITMENT);
        require(registry.commitmentOf(RUN_KEY) == COMMITMENT, "hash was replaced");
    }
}
