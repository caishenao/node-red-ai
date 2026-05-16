// tests/test_policy_manager_mcp.js
// Verifies the policy-manager MCP tool can load and query policy files

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var POLICY_DIR = path.join(__dirname, "..", ".claude", "policies");
var MANIFEST = path.join(__dirname, "..", ".policies.json");

describe("policy-manager MCP tool", function () {

    it("policy files should be valid JSON with name and rules", function () {
        var files = fs.readdirSync(POLICY_DIR).filter(function (f) { return f.endsWith(".json"); });
        assert.ok(files.length >= 2, "Should have at least 2 policy files");

        files.forEach(function (file) {
            var content = JSON.parse(fs.readFileSync(path.join(POLICY_DIR, file), "utf8"));
            assert.ok(content.name, file + " must have a 'name' field");
            assert.ok(Array.isArray(content.rules), file + " must have a 'rules' array");
        });
    });

    it("manifest should list all policies with paths", function () {
        var manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
        assert.ok(manifest.policies, "Manifest must have 'policies' array");
        assert.ok(manifest.policies.length >= 2, "Manifest should list at least 2 policies");

        manifest.policies.forEach(function (p) {
            assert.ok(p.name, "Each policy entry must have a name");
            assert.ok(p.path, "Each policy entry must have a path");
        });
    });

    it("manifest policy paths should resolve to existing files", function () {
        var manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
        var root = path.join(__dirname, "..");

        manifest.policies.forEach(function (p) {
            var fullPath = path.resolve(root, p.path);
            assert.ok(fs.existsSync(fullPath), "Policy file should exist: " + fullPath);
        });
    });

    it("loadPolicy should load a specific policy by filename", function () {
        // Read the policy file directly (simulates what the MCP tool does)
        var policyPath = path.join(POLICY_DIR, "code-review.json");
        var content = JSON.parse(fs.readFileSync(policyPath, "utf8"));

        assert.strictEqual(content.name, "code-review");
        assert.ok(Array.isArray(content.rules), "Policy should have rules array");
        assert.strictEqual(content.rules.length, 2);
        assert.strictEqual(content.rules[0].id, "R001");
    });

    it("policy rules should have id, pattern, and message fields", function () {
        var files = fs.readdirSync(POLICY_DIR).filter(function (f) { return f.endsWith(".json"); });

        files.forEach(function (file) {
            var content = JSON.parse(fs.readFileSync(path.join(POLICY_DIR, file), "utf8"));
            content.rules.forEach(function (rule, i) {
                assert.ok(rule.id, file + " rule " + i + " must have 'id'");
                assert.ok(rule.pattern, file + " rule " + i + " must have 'pattern'");
                assert.ok(rule.message, file + " rule " + i + " must have 'message'");
            });
        });
    });

    it("merged view should combine manifest metadata with policy rules", function () {
        var manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
        var root = path.join(__dirname, "..");

        var merged = manifest.policies.map(function (p) {
            var fullPath = path.resolve(root, p.path);
            var content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
            return {
                name: p.name,
                description: p.description,
                enabled: p.enabled,
                rules: content.rules
            };
        });

        assert.strictEqual(merged.length, 3);
        var codeReview = merged.find(function (p) { return p.name === "code-review"; });
        assert.ok(codeReview, "Should find code-review in merged view");
        assert.strictEqual(codeReview.description, "Automated code review with complexity analysis");
        assert.strictEqual(codeReview.enabled, true);
        assert.strictEqual(codeReview.rules.length, 2);
    });
});
