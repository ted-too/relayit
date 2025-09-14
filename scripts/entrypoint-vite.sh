#!/bin/sh
set -e

echo "Starting Vite environment variable replacement..."

# Get target directory from argument or use default
if [ -n "$1" ] && [ "$1" = "--target-dir" ]; then
  if [ -n "$2" ]; then
    search_dir="$2"
    shift 2
  else
    echo "Error: --target-dir requires a directory path"
    exit 1
  fi
else
  # Default directory to search
  search_dir="/app"
fi

echo "Searching for files in $search_dir"

# Create a sed script with all the environment variable replacements
sed_script=$(mktemp)
env_vars_count=0

# Look for VITE_ variables in the environment (including VITE_PUBLIC_)
env_vars=$(env | grep "^VITE_" || true)

# Process each environment variable
if [ -n "$env_vars" ]; then
  echo "$env_vars" | while IFS= read -r line; do
    # Extract the variable name and value
    var_name=$(echo "$line" | cut -d= -f1)
    var_value=$(echo "$line" | cut -d= -f2-)
    
    # Escape special characters for sed
    escaped_value=$(printf '%s\n' "$var_value" | sed 's/[[\.*^$()+?{|]/\\&/g')
    
    # Replace the BAKED_ prefixed version with the actual value
    echo "s|BAKED_${var_name}|${escaped_value}|g" >> "$sed_script"
    echo "Added replacement for $var_name"
  done
fi

# Get the final count
env_vars_count=$(wc -l < "$sed_script" 2>/dev/null || echo "0")

if [ "$env_vars_count" -eq 0 ]; then
  echo "No VITE_ environment variables found. Skipping replacements."
  rm -f "$sed_script"
else
  echo "Found $env_vars_count VITE_ environment variables to replace."
  
  # Replace in-place across all JS files
  find "$search_dir" -type f \( -name "*.js" -o -name "*.mjs" \) \
    -exec sed -i -f "$sed_script" {} + 2>/dev/null
  
  rm -f "$sed_script"
fi

echo "Environment variable replacement complete."

# Execute the command passed to the entry point
echo "Executing command: $@"
exec "$@"
