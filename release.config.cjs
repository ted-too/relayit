/**
 * semantic-release config (GitHub Releases only — no changelog commits).
 *
 * `main` → alpha prereleases (v1.0.0-alpha.N)
 * `stable` → required non-prerelease branch (placeholder until GA; do not push here)
 *
 * semantic-release rejects configs with only prerelease branches (ERELEASEBRANCHES).
 */
const commitAnalyzer = [
  "@semantic-release/commit-analyzer",
  {
    preset: "conventionalcommits",
    releaseRules: [
      { type: "feat", release: "patch" },
      { type: "fix", release: "patch" },
      { type: "perf", release: "patch" },
      { type: "revert", release: "patch" },
      { type: "docs", release: false },
      { type: "style", release: false },
      { type: "chore", release: false },
      { type: "refactor", release: "patch" },
      { type: "test", release: false },
      { type: "build", release: false },
      { type: "ci", release: false },
      { breaking: true, release: "minor" },
    ],
    parserOpts: {
      noteKeywords: ["BREAKING CHANGE", "BREAKING CHANGES", "BREAKING"],
    },
  },
];

const releaseNotes = [
  "@semantic-release/release-notes-generator",
  {
    preset: "conventionalcommits",
    parserOpts: {
      noteKeywords: ["BREAKING CHANGE", "BREAKING CHANGES", "BREAKING"],
    },
    writerOpts: {
      commitsSort: ["subject", "scope"],
    },
    presetConfig: {
      types: [
        { type: "feat", section: "Features" },
        { type: "fix", section: "Bug Fixes" },
        { type: "perf", section: "Performance" },
        { type: "revert", section: "Reverts" },
        { type: "refactor", section: "Refactoring" },
        { type: "docs", hidden: true },
        { type: "style", hidden: true },
        { type: "chore", hidden: true },
        { type: "test", hidden: true },
        { type: "build", hidden: true },
        { type: "ci", hidden: true },
      ],
    },
  },
];

const githubPlugin = [
  "@semantic-release/github",
  {
    successComment: false,
    failCommentCondition: false,
    releasedLabels: false,
  },
];

module.exports = {
  branches: [
    // Must exist on the remote — semantic-release requires ≥1 non-prerelease branch.
    { name: "stable" },
    { name: "main", prerelease: "alpha" },
  ],
  plugins: [commitAnalyzer, releaseNotes, githubPlugin],
};
