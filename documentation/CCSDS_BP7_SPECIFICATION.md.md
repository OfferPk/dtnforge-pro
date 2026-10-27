\# CCSDS 734.2-B-1 & IETF RFC 9171 Bundle Protocol Version 7 (BPv7) Specification

\#\# 1\. Overview & Operational Domain  
The \*\*Consultative Committee for Space Data Systems (CCSDS)\*\* Recommendation \*\*CCSDS 734.2-B-1\*\* (and its identical counterpart \*\*IETF RFC 9171\*\*) establishes the network layer standard for \*\*Delay-Tolerant Networking (DTN)\*\* across deep-space, lunar (LunaNet), Martian, and planetary exploration relay networks.

Unlike terrestrial TCP/IP which presumes continuous end-to-end connectivity, BPv7 provides custody transfer and asynchronous store-and-forward bundle delivery over high-latency, intermittently-connected space links.

\---

\#\# 2\. Bundle Structure & CBOR Representation  
Every BPv7 bundle is serialized as a deterministic, definite-length CBOR (RFC 8949\) array composed of:  
1\. \*\*Primary Bundle Block\*\* (exactly one, first element).  
2\. \*\*Canonical Extension Blocks\*\* (zero or more).  
3\. \*\*Payload Block\*\* (exactly one, final element).

\`\`\`text  
\[  
  PrimaryBlock,  
  \[HopCountBlock, BundleAgeBlock, ...\],  
  PayloadBlock  
\]  
\`\`\`

\#\#\# Primary Block Fields  
\- \`version\`: Unsigned integer 7\.  
\- \`bundle\_processing\_control\_flags\`: Bitmask defining bundle characteristics:  
  \- Bit 0: Is a fragment  
  \- Bit 1: Payload is an administrative record  
  \- Bit 2: Must not be fragmented  
  \- Bit 3: Custody transfer requested  
  \- Bit 5: Status time requested  
  \- Bit 6: Status report requested  
\- \`crc\_type\`: 0 (None), 1 (CRC-16 X.25), 2 (CRC-32C).  
\- \`destination\`: Endpoint Identifier (EID).  
\- \`source\`: Source node EID.  
\- \`report\_to\`: EID for administrative status reports.  
\- \`creation\_timestamp\`: Array \`\[dtn\_time\_ms, sequence\_number\]\`, where \`dtn\_time\_ms\` is milliseconds elapsed since 2000-01-01 00:00:00 UTC.  
\- \`lifetime\`: Milliseconds until bundle expiration.  
\- \`fragment\_offset\` & \`total\_adu\_length\` (present only if Bit 0 is 1).  
\- \`crc\`: Checksum over preceding fields.

\---

\#\# 3\. Canonical Extension Blocks  
\- \*\*Block Type 1 (Payload Block)\*\*: Contains the user Application Data Unit (ADU).  
\- \*\*Block Type 7 (Bundle Age Block)\*\*: Accumulates transit and storage latency in milliseconds when accurate creation timestamps are unavailable.  
\- \*\*Block Type 8 (Hop Count Block)\*\*: Enforces \`\[hop\_limit, current\_hop\_count\]\` to detect and discard packets caught in routing loops.  
