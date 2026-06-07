# Tester Invite Template

Subject: Try Codingape Office: a local-first AI coding worker for Mac

Hi,

I am running a small external pilot for Codingape Office, an open-source local AI coding worker for Mac.

It helps you try AI-assisted code changes safely:

- choose a local project folder
- configure your own model key or local model
- ask for a small change
- review the evidence and diff
- approve before any write
- rollback if needed

I am looking for feedback on one question:

Would you trust this workflow enough to use it on a real project?

## What I Need You To Try

1. Run or open Codingape Office.
2. Choose a small local project folder.
3. Pick one model mode:
   - Demo Only
   - BYO API Key
   - Local Model with Ollama / LM Studio
4. Click `Run First Task: Update README`.
5. Tell me where you got stuck.
6. Export the feedback JSON and support bundle if anything fails.

Good first tasks:

- update README instructions
- fix a small bug
- add input validation
- repair a failing test
- improve UI copy

## Safety Notes

- Do not test it first on a critical project. Use a small repo or a disposable branch.
- Do not paste API keys into screenshots, issues, or feedback.
- Codingape Office should not scan your full disk.
- Codingape Office should not write before you explicitly approve.
- Sensitive files such as `.env`, private keys, wallet files, and certificates should be skipped.

## Feedback Questions

- Did you understand what the tool was doing?
- Did you believe it would not auto-write code?
- Where was the first confusing step?
- Would you trust it with a real project?
- Score from 1 to 5.
- Would you pay for it? If yes, roughly how much?

Thanks for being one of the first testers.
