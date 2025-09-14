/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: this is fine */
module.exports = {
  branches: [
    {
      name: 'main',
      prerelease: 'alpha'
    }
  ],
  tagFormat: 'v${version}',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { type: 'docs', release: false },
          { type: 'style', release: false },
          { type: 'chore', release: false },
          { type: 'refactor', release: 'patch' },
          { type: 'test', release: false },
          { type: 'build', release: false },
          { type: 'ci', release: false },
          { breaking: true, release: 'major' }
        ]
      }
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: '🚀 Features' },
            { type: 'fix', section: '🐛 Bug Fixes' },
            { type: 'perf', section: '⚡ Performance' },
            { type: 'revert', section: '⏪ Reverts' },
            { type: 'refactor', section: '♻️ Refactoring' },
            { type: 'docs', hidden: true },
            { type: 'style', hidden: true },
            { type: 'chore', hidden: true },
            { type: 'test', hidden: true },
            { type: 'build', hidden: true },
            { type: 'ci', hidden: true }
          ]
        }
      }
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle: '# RelayIt Changelog\n\nAll notable changes to this project will be documented in this file.\n\n> **Note**: This project is currently in alpha. Breaking changes may occur between releases.'
      }
    ],
    [
      '@semantic-release/github',
      {
        addReleases: 'bottom'
      }
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
      }
    ]
  ]
};
