/**
 * 配置预设：把 15 个字段的组合收敛成三档，一键切换。
 *
 * 为什么放在服务端而不是两个 UI 各写一份：
 *   设置页分区（client.js）和独立页（lib/page.js）是两套渲染代码，
 *   如果各自维护预设表，两边迟早漂移成不同含义——同一个「新手档」
 *   在两个界面里给出不同配置，是最难排查的那类 bug。
 *   因此预设表只在这里定义，经 GET /settings 下发给两个界面。
 *
 * 每个预设只覆盖它关心字段，其余字段保持用户当前值不动：
 *   这样“切档”是叠加而非重置，用户手调过的 persona 不会被悄悄抹掉。
 */

/** 三档预设。顺序即展示顺序。 */
export const PRESETS = [
  {
    id: 'novice',
    label: '完全新手',
    labelEn: 'Total beginner',
    hint: '全白话、少术语，每步都解释；鼓励强度高',
    hintEn: 'Plain language, minimal jargon, explain every step',
    patch: {
      knowledgeLevel: 'plain',
      learningStage: 'foundation',
      detail: 'thorough',
      frameworkMap: true,
      stageSummary: true,
      skillCollaboration: true,
      playfulness: 'gentle',
      encouragement: 'active',
      observeTools: true,
      actionDigest: true,
      digestSize: 8,
      // 新手最容易误触危险命令，默认全套敏感名单。
      sensitiveTools: [
        'rm', 'del', 'Remove-Item', 'rmdir',
        'install', 'uninstall', 'update',
        'git', 'npm', 'pnpm', 'node', 'python', 'uvx',
        'kill', 'Stop-Process', 'Stop-Service', 'Restart',
      ],
    },
  },
  {
    id: 'guided',
    label: '有基础',
    labelEn: 'Some background',
    hint: '边做边学：白话 + 术语，带项目地图',
    hintEn: 'Learn by doing: plain language plus terms, with the project map',
    patch: {
      knowledgeLevel: 'guided',
      learningStage: 'framework',
      detail: 'thorough',
      frameworkMap: true,
      stageSummary: true,
      skillCollaboration: true,
      playfulness: 'gentle',
      encouragement: 'gentle',
      observeTools: true,
      actionDigest: true,
      digestSize: 8,
    },
  },
  {
    id: 'deep',
    label: '深度党',
    labelEn: 'Deep dive',
    hint: '追调用链、异常路径和数据结构；语气收敛',
    hintEn: 'Follow the call chain, error paths and data structures',
    patch: {
      knowledgeLevel: 'deep',
      learningStage: 'code',
      detail: 'thorough',
      frameworkMap: true,
      stageSummary: true,
      skillCollaboration: true,
      playfulness: 'off',
      encouragement: 'off',
      observeTools: true,
      actionDigest: true,
      digestSize: 12,
    },
  },
]

/** 预设 id 白名单，供服务端校验请求体。 */
export const PRESET_IDS = PRESETS.map((entry) => entry.id)

/** 取某个预设的 patch；未知 id 返回 undefined（调用方据此返回 400）。 */
export function presetPatch(id) {
  const found = PRESETS.find((entry) => entry.id === id)
  return found ? { ...found.patch } : undefined
}

/**
 * 只保留白名单字段的预设副本，用于下发给浏览器。
 * 下发的形状刻意和 PRESETS 一致，免得两个 UI 各写一套解析。
 */
export function presetList() {
  return PRESETS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    labelEn: entry.labelEn,
    hint: entry.hint,
    hintEn: entry.hintEn,
    patch: { ...entry.patch },
  }))
}

/**
 * 「试一下」示例动作：不是编造的效果演示，而是**真实会触发的场景**。
 * 只描述一个工具调用，交给 buildSectionText 去生成真实提示词。
 */
export const SAMPLE_ACTION = {
  zh: '刚执行完一次 shell 命令（npm test），结果里有 3 条断言失败。',
  en: 'A shell command (npm test) just finished with 3 failing assertions.',
}
