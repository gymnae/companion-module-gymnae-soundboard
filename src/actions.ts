import type ModuleInstance from './main.js'

export type ActionsSchema = {
	play: { options: { sound: string } }
	play_url: { options: { url: string } }
	stop: { options: Record<string, never> }
	volume: { options: { target: string; volume: number } }
	refresh: { options: Record<string, never> }
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		play: {
			name: 'Play sound',
			description: 'Plays a sound file. An http(s) URL entered as custom value is played as web stream instead.',
			options: [self.soundOption('Sound')],
			// Placing the action loads the sound's metadata and cover right away
			optionsToMonitorForSubscribe: ['sound'],
			subscribe: (action) => {
				self.useSound(`action:${action.id}`, String(action.options.sound ?? ''))
			},
			unsubscribe: (action) => {
				self.releaseSound(`action:${action.id}`)
			},
			callback: async (action) => {
				await self.play(String(action.options.sound ?? ''))
			},
		},
		play_url: {
			name: 'Play web stream / YouTube URL',
			options: [
				{
					type: 'textinput',
					id: 'url',
					label: 'URL',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action) => {
				await self.playUrl(String(action.options.url ?? ''))
			},
		},
		stop: {
			name: 'Stop all sounds',
			options: [],
			callback: async () => {
				await self.stop()
			},
		},
		volume: {
			name: 'Set volume',
			options: [
				{
					type: 'dropdown',
					id: 'target',
					label: 'Channel',
					default: 'local',
					choices: [
						{ id: 'local', label: 'Sound files' },
						{ id: 'remote', label: 'Web streams (YouTube)' },
					],
				},
				{
					type: 'number',
					id: 'volume',
					label: 'Volume (%)',
					default: 100,
					min: 0,
					max: 100,
					clampValues: true,
				},
			],
			callback: async (action) => {
				const target = action.options.target === 'remote' ? 'remote' : 'local'
				await self.setVolume(target, Number(action.options.volume))
			},
		},
		refresh: {
			name: 'Refresh sound list and covers',
			options: [],
			callback: async () => {
				await self.refreshMeta(true)
			},
		},
	})
}
