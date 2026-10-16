#!/bin/zsh
# Run this yourself, once: downloads the assistant's model (llama3.1:8b,
# ~4.9 GB) from the Ollama registry into the dashboard's own Ollama server
# (installed by install.sh). Ollama checks each layer's sha256 as it pulls.
# After this, the model server needs no network — block it in your firewall
# (see README "Assistant").
set -e
export OLLAMA_HOST=127.0.0.1:11435
"$HOME/.finance-ollama/bin/ollama" pull llama3.1:8b
"$HOME/.finance-ollama/bin/ollama" list
