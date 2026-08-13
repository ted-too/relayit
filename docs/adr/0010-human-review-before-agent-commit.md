# Human review before agent commit

After an agent finishes `/implement` (or equivalent end-to-end work), **do not commit until the human has reviewed the working tree and explicitly asks for a commit**. The implement skill’s default “commit when done” is overridden by this project preference: review-then-commit is the common workflow here, and auto-committing makes it harder to request changes before history is written.
