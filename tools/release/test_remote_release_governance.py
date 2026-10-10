import copy
import unittest
from tools.release.verify_remote_release_governance import (
    validate_rules,
    validate_environment,
    CORE_REFS,
)


def rule(target, refs, types):
    return {
        "target": target,
        "enforcement": "active",
        "bypass_actors": [],
        "conditions": {"ref_name": {"include": refs, "exclude": []}},
        "rules": [{"type": x} for x in types],
    }


class RemoteGovernanceTest(unittest.TestCase):
    def setUp(self):
        self.rules = [
            rule(
                "branch",
                ["refs/heads/main"],
                ["pull_request", "deletion", "non_fast_forward"],
            ),
            rule("tag", CORE_REFS, ["update", "deletion"]),
            rule("tag", ["refs/tags/docs/v*"], ["update"]),
        ]

    def test_both_scopes_keep_pr_boundary_and_immutable_refs(self):
        validate_rules(self.rules, "core")
        validate_rules(self.rules, "docs")

    def test_missing_pr_bypass_or_missing_tag_lock_fails(self):
        for index in (0, 1):
            candidate = copy.deepcopy(self.rules)
            candidate[index]["bypass_actors"] = [
                {"actor_type": "RepositoryRole", "actor_id": 5}
            ]
            with self.assertRaises(ValueError):
                validate_rules(candidate, "core")
        candidate = copy.deepcopy(self.rules)
        candidate[0]["rules"] = [{"type": "deletion"}, {"type": "non_fast_forward"}]
        with self.assertRaises(ValueError):
            validate_rules(candidate, "core")
        candidate = copy.deepcopy(self.rules)
        candidate[1]["conditions"]["ref_name"]["exclude"] = ["refs/tags/admin/*"]
        with self.assertRaises(ValueError):
            validate_rules(candidate, "core")

    def test_docs_can_be_deleted_but_never_force_updated(self):
        validate_rules(self.rules, "docs")
        self.rules[2]["rules"] = []
        with self.assertRaises(ValueError):
            validate_rules(self.rules, "docs")

    def test_environment_rejects_wider_tags_and_admin_bypass(self):
        env = {
            "can_admins_bypass": False,
            "deployment_branch_policy": {
                "protected_branches": False,
                "custom_branch_policies": True,
            },
            "protection_rules": [],
        }
        policies = {"branch_policies": [{"type": "tag", "name": "docs/v*"}]}
        validate_environment(env, policies, ["docs/v*"])
        for field, value in [
            ("can_admins_bypass", True),
            ("protection_rules", [{"type": "required_reviewers"}]),
        ]:
            candidate = copy.deepcopy(env)
            candidate[field] = value
            with self.assertRaises(ValueError):
                validate_environment(candidate, policies, ["docs/v*"])
        policies["branch_policies"].append({"type": "branch", "name": "main"})
        with self.assertRaises(ValueError):
            validate_environment(env, policies, ["docs/v*"])


if __name__ == "__main__":
    unittest.main()
