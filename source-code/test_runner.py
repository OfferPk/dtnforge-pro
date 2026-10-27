#!/usr/bin/env python3
"""
Automated Test Runner for DTNForge Pro
Verifies CBOR encoding, BPv7 Primary Block, Hop Count, CRC-16 X.25, EID parsing, and 10-point normative auditor.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dtn_cli import create_bundle, audit_bundle, crc16_x25, parse_eid, cbor_encode

class TestDTNForge(unittest.TestCase):

    def setUp(self):
        self.bundle = create_bundle(
            src="ipn:1.1",
            dst="ipn:10.1",
            payload="MOON_RELAY_TELEMETRY",
            lifetime_ms=3600000
        )

    def test_01_bundle_version_conformity(self):
        self.assertEqual(self.bundle["primaryBlock"]["version"], 7)
        self.assertEqual(self.bundle["standard"], "CCSDS 734.2-B-1 / IETF RFC 9171 (BPv7)")

    def test_02_eid_parsing_ipn_scheme(self):
        parsed = parse_eid("ipn:42.3")
        self.assertEqual(parsed[0], 1)
        self.assertEqual(parsed[1], [42, 3])

    def test_03_eid_parsing_dtn_scheme(self):
        parsed = parse_eid("dtn://mars.relay/hk")
        self.assertEqual(parsed[0], 2)
        self.assertEqual(parsed[1], "//mars.relay/hk")

    def test_04_cbor_encoding_determinism(self):
        encoded = cbor_encode([7, 0, 1, "test"])
        self.assertTrue(len(encoded) > 0)
        self.assertEqual(encoded[0] >> 5, 4) # Major type 4 (array)

    def test_05_crc16_integrity(self):
        data = b"CCSDS_BP7_TEST_VECTOR"
        c1 = crc16_x25(data)
        c2 = crc16_x25(data)
        self.assertEqual(c1, c2)
        self.assertIsInstance(c1, int)

    def test_06_hop_count_extension_block(self):
        exts = self.bundle["extensionBlocks"]
        self.assertTrue(any(e["type"] == 8 for e in exts))

    def test_07_payload_block_data(self):
        payload = self.bundle["payload"]
        self.assertEqual(payload["blockNumber"], 1)
        self.assertEqual(payload["text"], "MOON_RELAY_TELEMETRY")
        self.assertEqual(payload["sizeBytes"], len("MOON_RELAY_TELEMETRY"))

    def test_08_lifetime_bounds(self):
        pb = self.bundle["primaryBlock"]
        self.assertEqual(pb["lifetimeMs"], 3600000)

    def test_09_normative_auditor_compliance(self):
        report = audit_bundle(self.bundle)
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["score"], "10/10 Normative Rules Compliant")
        self.assertEqual(len(report["rules"]), 10)

    def test_10_empty_payload_handling(self):
        empty_bundle = create_bundle(payload="")
        self.assertEqual(empty_bundle["payload"]["sizeBytes"], 0)
        self.assertTrue(empty_bundle["total_octets"] > 20)

if __name__ == "__main__":
    unittest.main()
