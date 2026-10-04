// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Stores immutable commitments to off-chain Parallax decision records.
/// @dev A commitment proves record integrity only; it does not prove that the
///      underlying evidence is complete, authentic, or that a Decision is safe.
contract ParallaxDecisionRegistry {
    error InvalidAttestor();
    error UnauthorizedAttestor(address caller);
    error InvalidRunKey();
    error InvalidCommitment();
    error DecisionAlreadyAnchored(
        bytes32 runKey,
        bytes32 existingCommitment,
        bytes32 requestedCommitment
    );

    event DecisionAnchored(
        bytes32 indexed runKey,
        bytes32 commitment,
        address indexed attestor
    );

    address public immutable attestor;
    mapping(bytes32 runKey => bytes32 commitment) public commitmentOf;

    constructor(address initialAttestor) {
        if (initialAttestor == address(0)) revert InvalidAttestor();
        attestor = initialAttestor;
    }

    /// @notice Registers one decision commitment; exact retries are idempotent.
    function anchorDecision(bytes32 runKey, bytes32 commitment) external {
        if (msg.sender != attestor) revert UnauthorizedAttestor(msg.sender);
        if (runKey == bytes32(0)) revert InvalidRunKey();
        if (commitment == bytes32(0)) revert InvalidCommitment();

        bytes32 existingCommitment = commitmentOf[runKey];
        if (existingCommitment != bytes32(0)) {
            if (existingCommitment == commitment) return;
            revert DecisionAlreadyAnchored(
                runKey,
                existingCommitment,
                commitment
            );
        }

        commitmentOf[runKey] = commitment;
        emit DecisionAnchored(runKey, commitment, msg.sender);
    }
}
