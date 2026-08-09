import type { TargetType, PlayerEngine, RecorderEngine } from '../../shared/types'
import { WebRecorderEngine, WebPlayerEngine } from './webEngine'
import { DesktopRecorderEngine, DesktopPlayerEngine } from './desktopEngine'

const recorders: Record<TargetType, RecorderEngine> = {
  web: new WebRecorderEngine(),
  desktop: new DesktopRecorderEngine()
}

const players: Record<TargetType, PlayerEngine> = {
  web: new WebPlayerEngine(),
  desktop: new DesktopPlayerEngine()
}

export function getRecorder(targetType: TargetType): RecorderEngine {
  return recorders[targetType]
}

export function getPlayer(targetType: TargetType): PlayerEngine {
  return players[targetType]
}
