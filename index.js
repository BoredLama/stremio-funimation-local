
// largely based on: https://github.com/seiya-dev/funimation-downloader-nx/blob/master/funi.js

// this add-on does not have a catalog for now, only search supported

const pUrl = require('url')

const { config, proxy } = require('internal')

const needle = require('needle')
const cheerio = require('cheerio')
const async = require('async')

const defaults = {
	name: 'Funimation',
	prefix: 'funimation_',
	origin: '',
	endpoint: 'https://www.funimation.com',
	apiEndpoint: 'https://prod-api-funimationnow.dadcdigital.com/api',
	icon: 'https://www.underconsideration.com/brandnew/archives/funimation_logo.png',
	categories: []
}

let endpoint = defaults.endpoint

const episodes = {}

const headers = {
	'accept': 'application/json, text/plain, */*',
	'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
	'referer': endpoint,
	'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
}

function setEndpoint(str) {
	if (str) {
		let host = str
		if (host.endsWith('/index.php'))
			host = host.replace('/index.php', '/')
		if (!host.endsWith('/'))
			host += '/'
		endpoint = host
		const origin = endpoint.replace(pUrl.parse(endpoint).path, '')
		headers['origin'] = origin
		headers['referer'] = endpoint + '/'
	}
	return true
}

setEndpoint(defaults.endpoint)

function retrieveManifest() {
	function manifest() {
		return {
			id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
			version: '1.0.0',
			name: defaults.name,
			description: 'Anime from Funimation - Subcription needed',
			resources: ['stream', 'meta', 'catalog', 'subtitles'],
			types: ['series', 'anime'],
			idPrefixes: [defaults.prefix],
			icon: defaults.icon,
			catalogs: [
				{
					id: defaults.prefix + 'catalog',
					type: 'anime',
					name: defaults.name,
					extra: [{ name: 'search', isRequired: true }]
				}
			]
		}
	}

	return new Promise((resolve, reject) => {
		resolve(manifest())
	})
}

function findMeta(id) {
	let meta
	db.some(el => {
		if (id == el.id) {
			meta = el
			return true
		}
	})
	return meta
}

function findEpisode(id, sz, ep) {
	let episode
	episodes[id].some(el => {
		if (el.season == sz && el.number == ep) {
			episode = el
			return true
		}
	})
	return episode
}

function getEpisodes(id, cb) {
	let qs = { limit: -1, sort: 'order', sort_direction: 'ASC', title_id: parseInt(id,10) }
	qs.language = 'English'
	qs = Object.keys(qs).map(key => key + '=' + qs[key]).join('&')
	needle.get(defaults.apiEndpoint + '/funimation/episodes/?' + qs, { headers }, (err, resp, body) => {
		if (!episodes[id]) {
			episodes[id] = []
			setTimeout(() => {
				delete episodes[id]
			}, 3600000) // 1 hour cache
		}
		if (!err && ((body || {}).items || []).length) {
			let releasedTime = Date.now() - 86400000
			body.items.forEach(el => {
				episodes[id].push({
					name: el.title,
					season: parseInt((el.item || {}).seasonNum || sz),
					number: parseInt((el.item || {}).episodeNum || 1),
					slug: (el.item || {}).episodeSlug,
					metaSlug: (el.item || {}).titleSlug,
					released: new Date(releasedTime).toISOString()
				})
				releasedTime -= 86400000
			})
			cb(true)
		} else
			cb(false)
	})
}

function logIn() {
	needle.post('https://prod-api-funimationnow.dadcdigital.com/api' + '/auth/login/', 'username='+encodeURIComponent(config.email) + '&password=' + encodeURIComponent(config.password), { headers }, (err, resp, body) => {
		if (!err && (body || {}).token) {
			headers.Authorization = body.token
			console.log(defaults.name + ' - Logged In Successfully')
		} else {
			console.error(defaults.name + ' - Failed to Log In')
		}
	})
}

const db = []

function toMeta(obj) {
	let poster = (obj.image || {}).showDetailHeroSite
	if (poster)
		poster = poster.replace('/upload/oth/', '/upload/c_fill,q_60,w_250,h_362/oth/')
	let logo = (obj.image || {}).showDetailHeaderDesktop // or: backgroundImageAppletvfiretv
	if (logo)
		logo = logo.replace('/upload/oth/', '/upload/c_fill,q_80,w_500,h_200/oth/')
	const item = {
		id: defaults.prefix + obj.id,
		name: obj.title,
		type: 'series',
		imdbRating: (obj.rating *2).toFixed(2) + '',
		description: obj.synopsis,
		genres: obj.languages,
		background: (obj.image || {}).showMasterKeyArt,
		logo,
		poster,
		releaseInfo: obj.tx_date
	}
	db.push(item)
	return item
}

function getSubsUrl(m){
    for (let i in m) {
        const fpp = m[i].filePath.split('.')
        if (fpp[fpp.length-1] == 'srt') // dfxp, srt, vtt
            return { url: m[i].filePath, lang: ((m[i].languages || [])[0] || {}).title || 'English' }
    }
    return false
}

function getQuality(m){
	let qual
    for (let i in m)
    	if (!qual && m[i].mediaType == 'video')
    		qual = ((m[i].mediaInfo || {}).frameHeight || 360) + 'p'
    return qual
}

const subtitles = []

async function retrieveRouter() {

	logIn()

	const manifest = await retrieveManifest()

	const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

	const builder = new addonBuilder(manifest)

	builder.defineCatalogHandler(args => {
		return new Promise((resolve, reject) => {
			const extra = args.extra || {}
			if (extra.search) {
				let qs = {unique: true, limit: 100, q: extra.search, offset: 0 }
				qs = Object.keys(qs).map(key => key + '=' + qs[key]).join('&')
				needle.get(defaults.apiEndpoint + '/source/funimation/search/auto/?' + qs, { headers }, (err, resp, body) => {
					if (!err && ((body || {}).items || {}).total)
						resolve({ metas: body.items.hits.map(toMeta) })
					else
						reject(defaults.name + ' - No results')
				})
			} else {
				reject(defaults.name + ' - Unsupported catalog request')
			}
		})
	})

	builder.defineMetaHandler(args => {
		return new Promise((resolve, reject) => {
			const id = args.id.replace(defaults.prefix, '')
			const meta = findMeta(args.id) || {}
			if (!episodes[id]) {
				getEpisodes(id, () => {
					if (episodes[id])
						meta.videos = episodes[id]
					resolve({ meta })
				})
			} else {
				meta.videos = episodes[id]
				resolve({ meta })
			}
		})
	})

	builder.defineStreamHandler(args => {
		return new Promise((resolve, reject) => {
			const parts = args.id.replace(defaults.prefix, '').split(':')
			const season = parts[1]
			const episode = parts[2]
			const id = parts[0]
			const ep = findEpisode(id, season, episode)
			if ((ep || {}).slug && ep.metaSlug) {
				const url = defaults.apiEndpoint + '/source/catalog/episode/' + ep.metaSlug + '/' + ep.slug + '/'
				needle.get(url, { headers }, (err, resp, body) => {
					if (!err && ((body || {}).items || []).length) {
    					const ep = body.items[0]
					    let files = []
					    ep.media.forEach(m => {
					        if (m.mediaType == 'experience' && m.id > 0 && m.experienceType == 'Non-Encrypted') {
					        	const sub = getSubsUrl(m.mediaChildren)
					        	if (!subtitles[args.id])
					        		subtitles[args.id] = []
					        	subtitles[args.id].push(sub)
					            files.push({
					                id: m.id,
					                language: m.language,
					                version: m.version,
					                quality: getQuality(m.mediaChildren)
					            })
					        }
					    })
					    const streams = []
					    const vHeaders = JSON.parse(JSON.stringify(headers))
					    vHeaders.devicetype = 'Android Phone'
					    const q = async.queue((task, cb) => {
					    	needle.get(defaults.apiEndpoint + '/source/catalog/video/' + task.id + '/signed', { headers: vHeaders }, (err, resp, body) => {
					    		if (!err && ((body || {}).items || []).length)
					    			body.items.forEach(el => {
					    				streams.push({ url: el.src, title: task.language + ' - ' + task.quality + ', ' + el.videoType + ' / ' + task.version })
					    			})
					    		cb()
					    	})
					    })
					    q.drain = () => {
					    	if (streams.length)
						    	resolve({ streams })
						    else
						    	reject(defaults.name + ' - No streams found, maybe mature content or bad login credentials')
					    }
					    if (files.length)
						    files.reverse().forEach(file => {
						    	q.push(file)
						    })
						else
							reject(defaults.name + ' - No streams found for episode')
					} else {
						reject(defaults.name + ' - Could not get episode streams')
					}
				})
			} else
				reject(defaults.name + ' - Episode cache expired')
		})
	})

	builder.defineSubtitlesHandler(args => {
		return new Promise((resolve, reject) => {
			resolve({ subtitles: subtitles[args.id] || [] })
		})
	})

	const addonInterface = getInterface(builder)

	return getRouter(addonInterface)

}

module.exports = retrieveRouter()
