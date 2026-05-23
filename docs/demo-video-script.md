# AgoraBabel Demo Video Script

## 2-3 Minute Recording Script

Open on the landing screen with the sample source ready.

"AgoraBabel turns local-language news into validated prediction-market artifacts. It does not just generate prediction-market questions; it filters for markets that are resolvable, non-duplicate, evidence-backed, and commercially interesting."

Start the sample analysis.

"The pipeline first reads the original source and rejects weak signals. A naive system might turn any headline into a market, but AgoraBabel checks whether the article names a concrete event, a deadline, and a source that can later resolve YES or NO."

As the workflow reaches source and claim extraction:

"Here the system translates and summarizes the local-language source. In the Chile CEOL example, it separates agreed commercial terms from the unresolved government and Contraloria ratification step. That difference matters because the market must resolve on official action, not on news attention or price movement."

As resolver verification appears:

"Next, the resolver agent verifies the official source. This is the page or authority that can decide the outcome. If the resolver cannot be found or verified, the market is rejected instead of packaged."

As duplicate checking appears:

"Then AgoraBabel checks for duplicate or too-close markets. The point is not to publish another version of an existing question, but to find a new market opportunity."

As rejected candidates appear:

"The system also keeps the rejected candidate markets. News-confirmation questions are rejected because media coverage is downstream attention. Price-movement questions are rejected because market reaction is noisy. Company-statement questions are weaker than government or Contraloria publication."

Open the final artifact.

"The final artifact is a YES/NO market with clear criteria, a deadline, and an official resolution source. It now includes a market-balance check: an evidence-based YES probability, NO probability, verdict, and rationale. This is not live betting odds. It is business logic for filtering out questions that are too obvious or too unsupported to trade."

Point to the Market Balance panel.

"If YES is below fifteen percent or above eighty-five percent, AgoraBabel rejects the market as too lopsided. That prevents questions where almost nobody would rationally take the other side. Balanced questions are more commercially interesting because they can support two-sided prediction-market activity."

Scroll to proofs.

"Finally, the artifact is packaged with proof infrastructure: Circle test-wallet status, an Arc Testnet trace, and x402 paid-access metadata. The copied or downloaded Markdown memo includes the same market, resolver, probabilities, rationale, and trace summary, so the artifact can be reviewed outside the app."

Close on the feedback buttons.

"The feedback loop asks whether the artifact is tradable, not just grammatically valid. That is the product point: AgoraBabel finds local signals, rejects weak markets, and ships a verified, commercially useful market artifact."
