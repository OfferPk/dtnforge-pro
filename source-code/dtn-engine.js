/**
 * DTNForge Pro - CCSDS 734.2-B-1 & IETF RFC 9171 Bundle Protocol Version 7 (BPv7) Engine
 * Deterministic CBOR Encoder/Decoder, Primary Block Serializer, IPN/DTN Router, Extension Blocks, and CRC Calculator.
 * Standards: CCSDS 734.2-B-1 (Blue Book, 2022) / IETF RFC 9171 (BPv7) / RFC 8949 (CBOR)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DTNEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // DTN Epoch: 2000-01-01 00:00:00 UTC (946684800000 ms Unix)
  const DTN_EPOCH_UNIX_MS = 946684800000;

  // CRC-16 (X.25 / CCITT-REV) Implementation
  function crc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if ((crc & 1) !== 0) {
          crc = (crc >>> 1) ^ 0x8408; // reversed 0x1021
        } else {
          crc = crc >>> 1;
        }
      }
    }
    return (~crc) & 0xFFFF;
  }

  // CRC-32C (Castagnoli) Implementation
  function crc32c(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if ((crc & 1) !== 0) {
          crc = (crc >>> 1) ^ 0x82F63B78;
        } else {
          crc = crc >>> 1;
        }
      }
    }
    return (~crc) >>> 0;
  }

  // Minimal Deterministic CBOR Serializer (RFC 8949 / RFC 9171 Section 4.1)
  class SimpleCBOR {
    static encode(item) {
      if (item === null || item === undefined) {
        return new Uint8Array([0xF6]); // null
      }
      if (typeof item === 'boolean') {
        return new Uint8Array([item ? 0xF5 : 0xF4]);
      }
      if (typeof item === 'number') {
        return this.encodeNumber(item);
      }
      if (typeof item === 'string') {
        let utf8 = new TextEncoder().encode(item);
        let header = this.encodeHeader(3, utf8.length);
        let out = new Uint8Array(header.length + utf8.length);
        out.set(header);
        out.set(utf8, header.length);
        return out;
      }
      if (item instanceof Uint8Array) {
        let header = this.encodeHeader(2, item.length);
        let out = new Uint8Array(header.length + item.length);
        out.set(header);
        out.set(item, header.length);
        return out;
      }
      if (Array.isArray(item)) {
        let header = this.encodeHeader(4, item.length);
        let encodedItems = item.map(i => this.encode(i));
        let totalLen = header.length + encodedItems.reduce((acc, cur) => acc + cur.length, 0);
        let out = new Uint8Array(totalLen);
        out.set(header);
        let offset = header.length;
        for (let sub of encodedItems) {
          out.set(sub, offset);
          offset += sub.length;
        }
        return out;
      }
      if (typeof item === 'object') {
        let keys = Object.keys(item).sort();
        let header = this.encodeHeader(5, keys.length);
        let encodedPairs = [];
        for (let k of keys) {
          encodedPairs.push(this.encode(k));
          encodedPairs.push(this.encode(item[k]));
        }
        let totalLen = header.length + encodedPairs.reduce((acc, cur) => acc + cur.length, 0);
        let out = new Uint8Array(totalLen);
        out.set(header);
        let offset = header.length;
        for (let pair of encodedPairs) {
          out.set(pair, offset);
          offset += pair.length;
        }
        return out;
      }
      throw new Error("Unsupported CBOR type: " + typeof item);
    }

    static encodeHeader(major, value) {
      let majorBits = major << 5;
      if (value < 24) {
        return new Uint8Array([majorBits | value]);
      } else if (value <= 0xFF) {
        return new Uint8Array([majorBits | 24, value]);
      } else if (value <= 0xFFFF) {
        return new Uint8Array([majorBits | 25, (value >> 8) & 0xFF, value & 0xFF]);
      } else if (value <= 0xFFFFFFFF) {
        return new Uint8Array([
          majorBits | 26,
          (value >>> 24) & 0xFF,
          (value >>> 16) & 0xFF,
          (value >>> 8) & 0xFF,
          value & 0xFF
        ]);
      } else {
        let big = BigInt(value);
        return new Uint8Array([
          majorBits | 27,
          Number((big >> 56n) & 0xFFn),
          Number((big >> 48n) & 0xFFn),
          Number((big >> 40n) & 0xFFn),
          Number((big >> 32n) & 0xFFn),
          Number((big >> 24n) & 0xFFn),
          Number((big >> 16n) & 0xFFn),
          Number((big >> 8n) & 0xFFn),
          Number(big & 0xFFn)
        ]);
      }
    }

    static encodeNumber(val) {
      if (val >= 0) {
        return this.encodeHeader(0, Math.floor(val));
      } else {
        return this.encodeHeader(1, Math.floor(-1 - val));
      }
    }
  }

  class DTNEngine {
    constructor() {
      this.version = "1.0.0";
      this.standard = "CCSDS 734.2-B-1 / IETF RFC 9171 (BPv7)";
      this.cbor = SimpleCBOR;
    }

    /**
     * Parses an Endpoint Identifier (EID) string into BPv7 representation
     * Supports:
     * - ipn:node.service (e.g. ipn:10.1 -> [1, [10, 1]])
     * - dtn://node/service (e.g. dtn://mars.rover/telemetry -> [2, "//mars.rover/telemetry"])
     */
    parseEID(eidStr) {
      eidStr = (eidStr || "").trim();
      if (eidStr.startsWith("ipn:")) {
        let parts = eidStr.substring(4).split(".");
        let node = parseInt(parts[0], 10) || 0;
        let service = parseInt(parts[1], 10) || 0;
        return [1, [node, service]];
      } else if (eidStr.startsWith("dtn:")) {
        let ssp = eidStr.substring(4);
        return [2, ssp];
      } else {
        // Fallback or generic URI
        return [2, eidStr];
      }
    }

    /**
     * Formats parsed EID structure back into standard URI
     */
    formatEID(eidStruct) {
      if (!Array.isArray(eidStruct) || eidStruct.length < 2) return "dtn:none";
      let code = eidStruct[0];
      let ssp = eidStruct[1];
      if (code === 1 && Array.isArray(ssp)) {
        return `ipn:${ssp[0]}.${ssp[1]}`;
      } else if (code === 2) {
        return `dtn:${ssp}`;
      }
      return String(ssp);
    }

    /**
     * Creates a fully compliant BPv7 Bundle
     * @param {Object} options - Bundle configuration
     * @returns {Object} { bundleBytes, hex, primaryBlock, extensionBlocks, payloadBlock }
     */
    createBundle(options = {}) {
      const sourceEID = options.source || "ipn:1.1";
      const destEID = options.destination || "ipn:10.1";
      const reportEID = options.reportTo || "ipn:1.1";
      const payloadStr = options.payload || "DTN INTERPLANETARY PING";
      const lifetimeMs = options.lifetimeMs !== undefined ? options.lifetimeMs : 86400000; // 24 hours
      const crcType = options.crcType !== undefined ? options.crcType : 1; // 1 = CRC-16
      const hopLimit = options.hopLimit !== undefined ? options.hopLimit : 15;
      const currentHop = options.currentHop !== undefined ? options.currentHop : 0;
      const bundleAgeMs = options.bundleAgeMs !== undefined ? options.bundleAgeMs : 0;

      // Calculate DTN Time
      let nowUnix = Date.now();
      let dtnTime = Math.max(0, nowUnix - DTN_EPOCH_UNIX_MS);
      let seqNum = options.sequenceNumber || 1;

      // 1. Primary Bundle Block (RFC 9171 Section 4.2.1)
      let flags = 0;
      if (options.isCustodyRequested) flags |= (1 << 3);
      if (options.isStatusReportRequested) flags |= (1 << 6);

      let parsedDest = this.parseEID(destEID);
      let parsedSrc = this.parseEID(sourceEID);
      let parsedReport = this.parseEID(reportEID);

      // Assemble Primary Block elements without CRC field first
      let primaryFields = [
        7, // Version 7
        flags,
        crcType,
        parsedDest,
        parsedSrc,
        parsedReport,
        [dtnTime, seqNum],
        lifetimeMs
      ];

      // Compute CRC for Primary Block
      let primaryWithoutCrc = SimpleCBOR.encode(primaryFields);
      let primaryCrcBytes;
      if (crcType === 1) {
        let val = crc16(primaryWithoutCrc);
        primaryCrcBytes = new Uint8Array([(val >> 8) & 0xFF, val & 0xFF]);
      } else if (crcType === 2) {
        let val = crc32c(primaryWithoutCrc);
        primaryCrcBytes = new Uint8Array([(val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF]);
      } else {
        primaryCrcBytes = new Uint8Array(0);
      }

      let primaryBlock = primaryFields.concat([primaryCrcBytes]);

      // 2. Canonical Extension Blocks
      let extensionBlocks = [];

      // Hop Count Block (Block Type 8)
      if (hopLimit > 0) {
        let hopData = SimpleCBOR.encode([hopLimit, currentHop]);
        let hopBlockFields = [
          8, // Block Type 8
          2, // Block Number 2
          0, // Block Processing Control Flags
          0, // CRC Type (None)
          hopData
        ];
        extensionBlocks.push(hopBlockFields);
      }

      // Bundle Age Block (Block Type 7)
      if (bundleAgeMs >= 0) {
        let ageData = SimpleCBOR.encode(bundleAgeMs);
        let ageBlockFields = [
          7, // Block Type 7
          3, // Block Number 3
          0, // Block Processing Control Flags
          0, // CRC Type (None)
          ageData
        ];
        extensionBlocks.push(ageBlockFields);
      }

      // 3. Payload Block (Block Type 1)
      let payloadBytes = (typeof payloadStr === 'string') ? new TextEncoder().encode(payloadStr) : payloadStr;
      let payloadBlockFields = [
        1, // Block Type 1
        1, // Block Number 1
        0, // Block Flags
        crcType,
        payloadBytes
      ];

      // Compute CRC for Payload Block if configured
      let payloadWithoutCrc = SimpleCBOR.encode(payloadBlockFields);
      let payloadCrcBytes;
      if (crcType === 1) {
        let val = crc16(payloadWithoutCrc);
        payloadCrcBytes = new Uint8Array([(val >> 8) & 0xFF, val & 0xFF]);
      } else if (crcType === 2) {
        let val = crc32c(payloadWithoutCrc);
        payloadCrcBytes = new Uint8Array([(val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF]);
      } else {
        payloadCrcBytes = new Uint8Array(0);
      }
      let payloadBlock = payloadBlockFields.concat([payloadCrcBytes]);

      // Complete BPv7 Bundle is an array of [PrimaryBlock, ExtensionBlocks..., PayloadBlock]
      let bundleArray = [primaryBlock].concat(extensionBlocks).concat([payloadBlock]);
      let bundleBytes = SimpleCBOR.encode(bundleArray);

      let hex = Array.from(bundleBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      return {
        standard: this.standard,
        bundleBytes: bundleBytes,
        hex: hex,
        totalBytes: bundleBytes.length,
        primaryBlock: {
          version: 7,
          flags: flags,
          crcType: crcType,
          destination: destEID,
          source: sourceEID,
          reportTo: reportEID,
          dtnTimeMs: dtnTime,
          sequenceNumber: seqNum,
          lifetimeMs: lifetimeMs,
          crcHex: Array.from(primaryCrcBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('')
        },
        extensionBlocks: extensionBlocks.map(b => ({
          type: b[0],
          number: b[1],
          flags: b[2]
        })),
        payload: {
          blockNumber: 1,
          sizeBytes: payloadBytes.length,
          text: (typeof payloadStr === 'string') ? payloadStr : "[Binary Payload]"
        }
      };
    }
  }

  return DTNEngine;
}));
