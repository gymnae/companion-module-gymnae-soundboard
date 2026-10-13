import type ModuleInstance from './main.js'

export type VariablesSchema = {
	connected: boolean
	sound_count: number
	last_update: string
	playing: boolean
	now_playing_name: string
	now_playing_title: string
	now_playing_artist: string
	stream_title: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		connected: { name: 'Soundboard reachable' },
		sound_count: { name: 'Number of sounds' },
		last_update: { name: 'Time of the last successful metadata refresh' },
		playing: { name: 'Anything is playing' },
		now_playing_name: { name: 'File name of the sound playing' },
		now_playing_title: { name: 'Name of the sound playing (file name or title tag, see "Name sounds by")' },
		now_playing_artist: { name: 'Artist of the sound playing' },
		stream_title: { name: 'Title of the running web stream' },
	})
}
