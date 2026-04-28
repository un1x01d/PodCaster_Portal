#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_BASE="${1:-$ROOT_DIR/transfer_bundle}"
STAMP="$(date +%Y%m%d_%H%M%S)"
BUNDLE_DIR="${OUT_BASE}_${STAMP}"
ARCHIVE_NAME="$(basename "$BUNDLE_DIR").tar.gz"
ARCHIVE_PATH="$(dirname "$BUNDLE_DIR")/$ARCHIVE_NAME"

mkdir -p "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/images" "$BUNDLE_DIR/db" "$BUNDLE_DIR/project"

echo "[1/7] Resolving compose project and db volume..."
COMPOSE_PROJECT="$(docker compose -f "$ROOT_DIR/docker-compose.yml" config --format json | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 || true)"
if [[ -z "${COMPOSE_PROJECT:-}" ]]; then
  COMPOSE_PROJECT="$(basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
fi
DB_VOLUME="${COMPOSE_PROJECT}_db_data"

if ! docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  echo "ERROR: Docker volume '$DB_VOLUME' not found. Start compose first."
  exit 1
fi

echo "[2/7] Capturing compose/app files..."
cp "$ROOT_DIR/docker-compose.yml" "$BUNDLE_DIR/project/"
[[ -f "$ROOT_DIR/.env" ]] && cp "$ROOT_DIR/.env" "$BUNDLE_DIR/project/.env" || true
cp -r "$ROOT_DIR/db" "$BUNDLE_DIR/project/" || true

echo "[3/7] Exporting Postgres volume..."
docker run --rm \
  -v "$DB_VOLUME:/volume:ro" \
  -v "$BUNDLE_DIR/db:/backup" \
  alpine:3.20 \
  sh -c "cd /volume && tar czf /backup/db_volume.tar.gz ."

echo "[4/7] Finding compose images..."
mapfile -t IMAGES < <(docker compose -f "$ROOT_DIR/docker-compose.yml" images --quiet | sed '/^$/d' | sort -u)
if [[ "${#IMAGES[@]}" -eq 0 ]]; then
  echo "ERROR: No compose images found. Build/start compose first."
  exit 1
fi

echo "[5/7] Saving docker images..."
docker image save "${IMAGES[@]}" -o "$BUNDLE_DIR/images/compose_images.tar"

echo "[6/7] Writing restore script..."
cat > "$BUNDLE_DIR/restore_on_target.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$ROOT_DIR/project}"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "ERROR: project dir not found: $PROJECT_DIR"
  exit 1
fi

echo "[1/6] Loading Docker images..."
docker image load -i "$ROOT_DIR/images/compose_images.tar"

echo "[2/6] Switching to project dir..."
cd "$PROJECT_DIR"

echo "[3/6] Ensuring .env exists..."
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
fi

echo "[4/6] Starting compose once to create volume/network..."
docker compose up -d

echo "[5/6] Restoring db volume..."
COMPOSE_PROJECT="$(docker compose config --format json | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 || true)"
if [[ -z "${COMPOSE_PROJECT:-}" ]]; then
  COMPOSE_PROJECT="$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
fi
DB_VOLUME="${COMPOSE_PROJECT}_db_data"

docker compose down
docker run --rm \
  -v "$DB_VOLUME:/volume" \
  -v "$ROOT_DIR/db:/backup:ro" \
  alpine:3.20 \
  sh -c "rm -rf /volume/* && cd /volume && tar xzf /backup/db_volume.tar.gz"

echo "[6/6] Starting final compose..."
docker compose up -d
echo "Done. App should be up with restored DB data."
EOF
chmod +x "$BUNDLE_DIR/restore_on_target.sh"

echo "[7/7] Creating transfer archive..."
tar czf "$ARCHIVE_PATH" -C "$(dirname "$BUNDLE_DIR")" "$(basename "$BUNDLE_DIR")"

cat <<MSG

Bundle created:
  $ARCHIVE_PATH

On target PC:
  1) Copy archive and extract it
  2) Run:
       ./$(basename "$BUNDLE_DIR")/restore_on_target.sh
     or pass project path:
       ./$(basename "$BUNDLE_DIR")/restore_on_target.sh /path/to/Data_Insights_Portal

MSG
