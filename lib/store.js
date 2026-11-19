/**
 * 极简 JSON 持久化。
 *
 * 为什么需要它：插件配置写在 `cordis.patch.yml` 里，那是“启动时读一次”的文件，
 * 用户在界面上改的配置不能回写进去（回写会改坏官方 profile 的配置文件）。
 * 所以运行时可改的配置存进插件自己的数据目录：`<DSH_HOME>/ai-action-translator/settings.json`。
 *
 * 三层保护：
 *  1. 原子写：先写 `.tmp-<pid>`，再 rename 覆盖。中途断电不会留下半截 JSON。
 *  2. 坏文件不静默丢弃：解析失败时把原文件另存为 `.corrupt-<时间戳>` 再退回默认值。
 *  3. 默认值兜底：任何一步失败都保证内存里仍是一份可用的完整配置。
 *
 * 本文件不联网、不读用户项目、不碰 DSH 核心文件。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 数据目录名（放在 DSH 家目录下，与官方插件习惯一致）。 */
export const DATA_DIR_NAME = 'ai-action-translator'

/** 解析 DSH 家目录：优先环境变量，其次 `~/.dsh`。 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return path.resolve(fromEnv.trim())
  return path.join(os.homedir(), '.dsh')
}

function clone(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

export class JsonStore {
  #file
  #log
  #state
  #dirty = false

  constructor(file, initial, options = {}) {
    this.#file = file
    this.#log = typeof options.log === 'function' ? options.log : () => {}
    this.#state = typeof initial === 'function' ? initial() : clone(initial)
    this.#load()
  }

  #load() {
    if (!fs.existsSync(this.#file)) return
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8'))
    } catch (error) {
      this.#quarantine(error)
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.#quarantine(new Error('top-level JSON value is not an object'))
      return
    }
    // 只覆盖已知键，保证“文件里少了新字段”不会让配置变残缺。
    this.#state = { ...this.#state, ...parsed }
  }

  #quarantine(error) {
    this.#log(`[store] ${path.basename(this.#file)} unreadable: ${String(error?.message ?? error)}`)
    try {
      const backup = `${this.#file}.corrupt-${Date.now()}`
      fs.copyFileSync(this.#file, backup)
      this.#log(`[store] kept the unreadable copy at ${backup}`)
    } catch {
      // 备份失败也不能让插件启动失败：内存里已有默认值。
    }
  }

  /** 读取当前状态（返回的是内部对象，调用方只读使用）。 */
  get() {
    return this.#state
  }

  /** 合并式更新，返回更新后的状态。 */
  update(patch) {
    if (patch === null || typeof patch !== 'object') return this.#state
    this.#state = { ...this.#state, ...patch }
    this.#dirty = true
    return this.#state
  }

  /** 整体替换（「恢复默认」用：清空全部已保存键，回到传入的目标状态）。 */
  replace(state) {
    this.#state = clone(state ?? {})
    this.#dirty = true
    return this.#state
  }

  /** 落盘。没有改动时直接返回 false（不做无意义的写盘）。 */
  flush() {
    if (!this.#dirty) return false
    this.#dirty = false
    const tmp = `${this.#file}.tmp-${process.pid}`
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true })
      fs.writeFileSync(tmp, `${JSON.stringify(this.#state, null, 2)}\n`, 'utf8')
      fs.renameSync(tmp, this.#file)
      return true
    } catch (error) {
      this.#dirty = true
      try {
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true })
      } catch {
        // 清理临时文件失败不影响结论。
      }
      this.#log(`[store] failed to persist ${path.basename(this.#file)}: ${String(error?.message ?? error)}`)
      throw error
    }
  }

  /** 卸载时尽力保存一次；失败只记日志，不抛错（卸载流程不应该被数据问题打断）。 */
  dispose() {
    try {
      this.flush()
    } catch {
      // 已由 flush 记录日志。
    }
  }
}
