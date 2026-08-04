/**
 * Shell completion scripts for oms / oh-my-session.
 *
 *   oms completion bash
 *   oms completion zsh
 *   oms completion fish
 */
import { CLI_NAMES } from "./pkg-meta.js";

export type ShellKind = "bash" | "zsh" | "fish";

const FLAGS = [
  "--help",
  "-h",
  "--version",
  "-V",
  "--list",
  "-l",
  "--json",
  "-j",
  "--source",
  "-s",
  "--cwd",
  "--limit",
] as const;

const SUBCOMMANDS = ["version", "upgrade", "completion"] as const;
const SOURCES = ["grok", "qoder", "claude"] as const;
const SHELLS: ShellKind[] = ["bash", "zsh", "fish"];

export function parseShellKind(raw: string | undefined): ShellKind | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "bash" || s === "zsh" || s === "fish") return s;
  return null;
}

export function completionScript(shell: ShellKind): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
  }
}

function bashScript(): string {
  const cmds = CLI_NAMES.join(" ");
  const flagList = FLAGS.join(" ");
  const subList = SUBCOMMANDS.join(" ");
  const srcList = SOURCES.join(" ");
  const shellList = SHELLS.join(" ");
  return `# oh-my-session bash completion
# Install: eval "$(oms completion bash)"  ·  or append to ~/.bashrc

_oms_completion() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "\${prev}" in
    --source|-s)
      COMPREPLY=( $(compgen -W "${srcList}" -- "\${cur}") )
      return 0
      ;;
    --cwd)
      COMPREPLY=( $(compgen -d -- "\${cur}") )
      return 0
      ;;
    --limit)
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${shellList}" -- "\${cur}") )
      return 0
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "${flagList}" -- "\${cur}") )
    return 0
  fi

  COMPREPLY=( $(compgen -W "${subList} ${flagList}" -- "\${cur}") )
}

complete -F _oms_completion ${cmds}
`;
}

function zshScript(): string {
  const cmds = CLI_NAMES.join(" ");
  const srcList = SOURCES.join(" ");
  return `#compdef ${cmds}
# oh-my-session zsh completion
# Install: oms completion zsh > "\${fpath[1]}/_oms"  &&  exec zsh
#   or:    eval "$(oms completion zsh)"

_oms() {
  local -a cmds flags sources shells
  cmds=(
    'version:Show version and update status'
    'upgrade:Print upgrade instructions'
    'completion:Print shell completion script'
  )
  flags=(
    '--help[Show help]'
    '-h[Show help]'
    '--version[Show version]'
    '-V[Show version]'
    '--list[Plain table on stdout]'
    '-l[Plain table on stdout]'
    '--json[JSON array on stdout]'
    '-j[JSON array on stdout]'
    '--source[Filter by agent source]:source:(${srcList})'
    '-s[Filter by agent source]:source:(${srcList})'
    '--cwd[Filter by resume cwd]:directory:_files -/'
    '--limit[Max sessions]:number:'
  )
  shells=(bash zsh fish)

  _arguments -C -s -S \\
    $flags \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe -t commands 'oms command' cmds
      ;;
    args)
      case $words[1] in
        completion)
          _describe -t shells 'shell' shells
          ;;
      esac
      ;;
  esac
}

compdef _oms ${cmds}
`;
}

function fishScript(): string {
  const lines: string[] = [
    "# oh-my-session fish completion",
    "# Install: oms completion fish > ~/.config/fish/completions/oms.fish",
    "",
  ];
  for (const cmd of CLI_NAMES) {
    lines.push(`complete -c ${cmd} -f`);
    lines.push(
      `complete -c ${cmd} -s h -l help -d 'Show help'`,
      `complete -c ${cmd} -s V -l version -d 'Show version'`,
      `complete -c ${cmd} -s l -l list -d 'Plain table on stdout'`,
      `complete -c ${cmd} -s j -l json -d 'JSON array on stdout'`,
      `complete -c ${cmd} -s s -l source -d 'Filter by agent' -xa '${SOURCES.join(" ")}'`,
      `complete -c ${cmd} -l cwd -d 'Filter by resume cwd' -r`,
      `complete -c ${cmd} -l limit -d 'Max sessions' -r`,
      `complete -c ${cmd} -n '__fish_use_subcommand' -a version -d 'Show version and update status'`,
      `complete -c ${cmd} -n '__fish_use_subcommand' -a upgrade -d 'Print upgrade instructions'`,
      `complete -c ${cmd} -n '__fish_use_subcommand' -a completion -d 'Print shell completion script'`,
      `complete -c ${cmd} -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish' -d 'Shell'`,
      "",
    );
  }
  return lines.join("\n");
}
