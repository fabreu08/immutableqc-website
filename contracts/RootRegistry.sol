// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.20;

/// @title RootRegistry
/// @notice Minimal attestation registry for Immutable QC Merkle roots.
///         Each sealed batch of QC records is hashed into a Merkle root off chain.
///         Publishing that root here creates a public, timestamped, non-editable
///         record that the batch existed in this form at this block.
/// @dev    Deployed on the Filecoin EVM (FEVM). Compiled for the Paris EVM
///         target so the bytecode avoids PUSH0 and stays portable.
contract RootRegistry {
    struct Attestation {
        address publisher;
        uint64 blockNumber;
        uint64 timestamp;
        uint64 fromSeq;
        uint64 toSeq;
    }

    /// @notice Emitted once per published root. Indexed so an auditor can
    ///         look up a root or a publisher directly from the logs.
    event RootAttested(
        bytes32 indexed root,
        address indexed publisher,
        uint64 fromSeq,
        uint64 toSeq,
        string batchId,
        uint256 timestamp
    );

    /// @notice root => first attestation. A root can only be attested once.
    mapping(bytes32 => Attestation) private _attestations;

    /// @notice Total number of roots attested through this registry.
    uint256 public count;

    error RootAlreadyAttested(bytes32 root);
    error EmptyRoot();

    /// @notice Publish a Merkle root.
    /// @param root     SHA-256 Merkle root of the batch (32 bytes).
    /// @param fromSeq  First ledger sequence number in the batch.
    /// @param toSeq    Last ledger sequence number in the batch.
    /// @param batchId  Off-chain batch identifier (for example "cmt-7a3c9e12").
    function attest(bytes32 root, uint64 fromSeq, uint64 toSeq, string calldata batchId) external {
        if (root == bytes32(0)) revert EmptyRoot();
        if (_attestations[root].publisher != address(0)) revert RootAlreadyAttested(root);

        _attestations[root] = Attestation({
            publisher: msg.sender,
            blockNumber: uint64(block.number),
            timestamp: uint64(block.timestamp),
            fromSeq: fromSeq,
            toSeq: toSeq
        });
        unchecked {
            count += 1;
        }

        emit RootAttested(root, msg.sender, fromSeq, toSeq, batchId, block.timestamp);
    }

    /// @notice Look up a root. `publisher == address(0)` means it was never attested.
    function attestation(bytes32 root)
        external
        view
        returns (address publisher, uint64 blockNumber, uint64 timestamp, uint64 fromSeq, uint64 toSeq)
    {
        Attestation storage a = _attestations[root];
        return (a.publisher, a.blockNumber, a.timestamp, a.fromSeq, a.toSeq);
    }

    /// @notice Cheap yes/no check used by the auditor view.
    function isAttested(bytes32 root) external view returns (bool) {
        return _attestations[root].publisher != address(0);
    }
}
