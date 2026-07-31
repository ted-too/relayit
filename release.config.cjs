/**
 * semantic-release config (no changelog commits; GitHub Releases only).
 *
 * `main` publishes alpha prereleases: v1.0.0-alpha.N
 * Seeded from baseline tag v1.0.0-alpha.0 after the release pipeline lands.
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
    failComment: false,
    releasedLabels: false,
  },
];

module.exports = {
  branches: [
    {
      name: "main",
      prerelease: "alpha",
    },
  ],
  plugins: [commitAnalyzer, releaseNotes, githubPlugin],
};
