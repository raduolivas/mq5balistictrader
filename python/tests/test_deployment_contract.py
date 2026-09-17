from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class DeploymentContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.compose = (ROOT / "deploy" / "docker-compose.yml").read_text(encoding="utf-8")
        cls.dockerfile = (ROOT / "python" / "Dockerfile").read_text(encoding="utf-8")
        cls.apparmor = (ROOT / "deploy" / "rootlesskit.apparmor").read_text(encoding="utf-8")

    def test_only_tcp_bridge_is_published_and_only_on_loopback(self) -> None:
        self.assertIn('"127.0.0.1:5555:5555"', self.compose)
        self.assertNotIn('"5556:5556"', self.compose)
        self.assertNotIn('"5557:5557"', self.compose)
        self.assertNotIn("network_mode: host", self.compose)

    def test_zeromq_uses_internal_service_dns(self) -> None:
        self.assertIn('FOREX_SUB_ENDPOINT: "tcp://mt5-bridge:5557"', self.compose)
        self.assertIn('FOREX_SIGNAL_ENDPOINT: "tcp://mt5-bridge:5556"', self.compose)
        self.assertIn('BRIDGE_TICK_PUB_ENDPOINT: "tcp://0.0.0.0:5557"', self.compose)
        self.assertIn('BRIDGE_SIGNAL_PULL_ENDPOINT: "tcp://0.0.0.0:5556"', self.compose)

    def test_services_are_hardened_and_health_checked(self) -> None:
        for token in (
            "read_only: true",
            'user: "10001:10001"',
            "pids_limit: 64",
            "mem_limit: 256m",
            "cap_drop:",
            "- ALL",
            "no-new-privileges:true",
            '["CMD", "python", "healthcheck.py", "bridge"]',
            '["CMD", "python", "healthcheck.py", "engine"]',
        ):
            self.assertIn(token, self.compose)

    def test_image_runs_as_unprivileged_runtime_user(self) -> None:
        self.assertIn("useradd --no-create-home --uid 10001", self.dockerfile)
        self.assertIn("USER engine", self.dockerfile)
        self.assertNotIn("requirements-train.txt", self.dockerfile)

    def test_rootless_apparmor_exception_is_binary_scoped(self) -> None:
        self.assertIn("/home/cybersecrad/bin/rootlesskit flags=(unconfined)", self.apparmor)
        self.assertIn("userns,", self.apparmor)
        self.assertNotIn("/**", self.apparmor)


if __name__ == "__main__":
    unittest.main()
