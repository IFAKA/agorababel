// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TraceRegistry {
    event TraceCommitted(
        bytes32 indexed artifactHash,
        bytes32 indexed sourceHash,
        string marketId,
        address indexed committer,
        uint256 timestamp
    );

    mapping(bytes32 => bool) public committed;

    function commitTrace(
        bytes32 artifactHash,
        bytes32 sourceHash,
        string calldata marketId
    ) external {
        require(!committed[artifactHash], "TRACE_ALREADY_COMMITTED");
        committed[artifactHash] = true;
        emit TraceCommitted(
            artifactHash,
            sourceHash,
            marketId,
            msg.sender,
            block.timestamp
        );
    }
}
