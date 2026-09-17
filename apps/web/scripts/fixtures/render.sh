#!/bin/bash
# Renders a local HTML fixture to a PNG via headless Chrome -- used to build
# controlled, known-ground-truth "document photo" fixtures for the vision
# extraction systems' evaluation scripts (AI-005/006/007/012), since a real
# photo of a real physical document/pack isn't available in this
# environment. Crisp, high-fidelity synthetic labels test the real
# transcription behaviour just as well as a photo for text-layout purposes;
# they are not a substitute for testing against real-world photo artifacts
# (glare, blur, angle) before trusting any of these systems against real
# patient-submitted photos.
#
# Usage: bash render.sh <input.html> <output.png> <width>,<height>
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$CHROME" --headless --disable-gpu --screenshot="$DIR/$2" --window-size="$3" "file://$DIR/$1"
