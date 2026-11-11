# Analogy tutor — milestone 1

A local scripted demo for query/key/value. No API, backend, dependencies, saved storage, or billing. Open index.html in a browser (from PowerShell: `Start-Process .\index.html`).

Files: index.html is the page structure; styles.css controls appearance; content.js contains teaching responses; provider.js selects a response; app.js handles clicks, tab-memory history and safe text rendering.

Try: Explain from scratch → Sample: Is the value the score? → Sample: partly correct explain-back → Show the technical explanation → Give me a quick check → enter [1, 6]. Also try I know a little (with and without an answer), reveal answer, skip, an unsupported question, and reset. Refresh should erase the conversation. Entering HTML should display literal text and never execute.

The scripted provider only recognises selected patterns. It does not assess general free-form explanations or personalise the story from prior knowledge. Topic selection and preferred settings are deferred. This first milestone deliberately covers only one library story and Q/K/V.

Technical source: https://arxiv.org/html/1706.03762v7#S3.SS2 (sections 3.2 and 3.4). The supplied worked example was checked arithmetically; it does not derive weights from query/key vectors. No learner evaluation or model comparison has been conducted.

Next milestones: Express with isolated in-memory sessions; backend LLM integration with current pricing and budget controls; evaluation against a matched basic prompt; only then more topics. Pause after milestone 1 for learner testing.
