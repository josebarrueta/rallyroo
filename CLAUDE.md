## Delegation policy

You have shell access to a local model running via `pi` + Ollama. Use it
to offload mechanical, low-risk subtasks so you can spend your own
reasoning on the parts that actually need it.

### When to delegate

Delegate when a subtask is:
- Mechanical: boilerplate, renames, simple formatting/reformatting
- Low-risk: easy to verify correct at a glance, low blast radius if wrong
- Self-contained: doesn't require broader codebase context you'd have to
  re-explain in full

Do NOT delegate:
- Architecture or design decisions
- Anything with ambiguous or underspecified requirements
- Security-sensitive code (auth, crypto, permissions, input validation)
- Anything you can't quickly verify once it comes back

### How to delegate

Run the local model directly via shell:

```bash
pi --provider ollama --model qwen3.8:27b-mlx -p "<clear, self-contained task description>"
```

Guidelines for the prompt you send it:
- Include any relevant file contents or snippets inline — it has no
  access to your conversation context.
- Be explicit about the expected output format (e.g. "return only the
  function body", "output a unified diff").
- Keep the task narrow. One subtask per call, not a multi-step request.

### After delegation

Treat the output as a draft, not a finished change:
1. Read it fully before using it.
2. Check it actually does what was asked — local models can produce
   plausible-looking but subtly wrong code.
3. Run relevant tests/lint on anything it touches before considering the
   subtask done.
4. If the output is wrong or low quality, either fix it yourself or
   redo the subtask with a more specific prompt — don't retry blindly.

### Model swap

If `qwen3.8:27b-mlx` isn't pulled or Ollama isn't running, check with:

```bash
ollama list
```

and fall back to doing the subtask yourself rather than blocking on it.
