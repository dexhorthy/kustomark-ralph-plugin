-1a. list issues from GitHub: `curl -s https://api.github.com/repos/dexhorthy/kustomark-ralph-plugin/issues | jq -r '.[] | "\(.number) \(.title)"'`

-1b. compare with known-issues/ directory - if any GitHub issues aren't local, fetch and save:
     `curl -s https://api.github.com/repos/dexhorthy/kustomark-ralph-plugin/issues/<NUMBER> | jq '{number, title, body}' > known-issues/<NUMBER>.json`

-1c. TBD

0a. familiarize yourself with specs/


0b. familiarize yourself with the code in src/

1. read @IMPLEMENTATION_PLAN.md and implement the single highest priority feature using up to 5 subagents, including anything in the out of scope / future work - that's now in scope!

2. ensure all tests and linting passes with `bun check && bun test`, then update IMPLEMENTATION_PLAN.md with your progress

3. use `git add -A` and `git commit -m "..."` to commit your changes - do not include any claude attribution

4. git push origin main
