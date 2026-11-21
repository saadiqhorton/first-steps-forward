import type { Agent, AgentModelsResult, OptionCapabilities } from '@/lib/ade/types';
const base = { tools: '', authMethod: '', authNote: '', signIn: { note: '' }, carriesConversation: true, installHint: '' };
const agents: Agent[] = [
  { ...base, id: 'claude', name: 'Claude Code', short: 'C', installed: true, signedIn: true, installMethod: 'npm', version: '2.1.325' },
  { ...base, id: 'codex', name: 'Codex', short: 'C', installed: true, signedIn: true, installMethod: 'npm' },
  { ...base, id: 'grok', name: 'Grok Build', short: 'G', installed: false, signedIn: false, installMethod: 'missing' },
  { ...base, id: 'opencode', name: 'OpenCode', short: 'O', installed: true, signedIn: true, installMethod: 'npm' },
  { ...base, id: 'antigravity', name: 'Antigravity', short: 'A', installed: false, signedIn: false, installMethod: 'missing' },
  { ...base, id: 'muse', name: 'Muse Code', short: 'M', installed: false, signedIn: false, installMethod: 'missing' },
];
const catalogs: Record<string, string[]> = {
  claude: ['Opus 5.5', 'Sonnet 5.5', 'Fable 5.2', 'Haiku 5.5', 'Fable 5.1', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5'],
  codex: ['GPT-6 Luna', 'ollama/deepseek-v4.1-flash:cloud', 'ollama/glm-5.3-flash:cloud', 'GPT-6.1 Sol', 'Astra', 'ollama/beam:cloud', 'ollama/deepseek-v4-pro:cloud', 'ollama/deepseek-v4.1-flash:cloud-omb-64k', 'ollama/devstral-2:123b-cloud', 'GPT-6.1 Terra'],
  opencode: ['OpenCode/Big Pickle', 'OpenAI/Daybreak Blue', 'OpenAI/Daybreak Red', 'OpenAI/GPT-4.1', 'OpenAI/GPT-4.1 Fast', 'OpenAI/GPT-4.1 mini', 'OpenAI/GPT-4.1 mini Fast', 'OpenAI/GPT-4o', 'OpenAI/GPT-4o (2024-08-06)', 'OpenAI/GPT-4o (2024-11-20)', 'OpenAI/GPT-4o Fast', 'OpenAI/GPT-4o mini'],
};
export function useAdeState<T>(selector: (state: { agents: Agent[] }) => T): T { return selector({ agents }); }
export async function agentModels(id: string): Promise<AgentModelsResult> {
  return { available: true, source: 'cli', completeCatalog: id === 'opencode', models: (catalogs[id] ?? []).map(label => ({ id: label, label })) } as AgentModelsResult;
}
const permissionRows: Record<string, Pick<OptionCapabilities, 'permissions' | 'permissionLabels' | 'permissionNotes'>> = {
  claude: {
    permissions: ['manual', 'build', 'plan', 'auto', 'dont-ask', 'bypass'],
    permissionLabels: { manual: 'Manual', build: 'Accept edits', plan: 'Plan', auto: 'Auto', 'dont-ask': "Don't ask", bypass: 'Bypass permissions' },
    permissionNotes: { manual: 'Claude Code asks you in ADE before actions that need permission.', build: 'Claude Code accepts file edits; shell commands and other actions ask you in ADE first.', plan: 'Claude Code plan mode: reads and plans, no edits.', auto: 'Claude Code handles permission decisions automatically.', 'dont-ask': 'Claude Code asks nothing: ADE declines actions that would need permission.', bypass: 'Claude Code accepts every permission request without asking.' },
  },
  codex: {
    permissions: ['plan', 'build', 'approve', 'full'],
    permissionLabels: { plan: 'Read-only', build: 'Ask for approval', approve: 'Approve for me', full: 'Full access' },
    permissionNotes: { plan: 'Codex read-only sandbox: reads and answers, cannot edit files.', build: 'Codex workspace-write sandbox; approval requests follow its non-interactive policy.', approve: 'Codex routes approval requests through automatic review in its workspace-write sandbox.', full: 'Codex runs with no sandbox and no approval prompts.' },
  },
  opencode: {
    permissions: ['build', 'plan'],
    permissionLabels: { build: 'Build', plan: 'Plan' },
    permissionNotes: { build: 'Make changes using your configured OpenCode permissions.', plan: 'Plan without making changes.' },
  },
};
export async function optionCapabilities(id: string): Promise<OptionCapabilities> {
  return { efforts: id === 'opencode' ? [] : ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], speeds: id === 'opencode' ? [] : ['fast'], effortNote: '', speedNote: '', ...permissionRows[id] } as OptionCapabilities;
}
