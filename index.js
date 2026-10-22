#!/usr/bin/env node
// Entry point
// Parse arguments and setup the enviroment

// Dependencies
var parseArgs = require('util').parseArgs
var _package = require('./package.json')
var Grf  = require('./lib/grf.js')
var ProgressBar = require('progress')
var Fs = require('fs')

// Setup args
var options = {
	grf: {
		type: 'string',
		short: 'g',
		describe: 'The grf file to be worked on.',
	},
	search: {
		type: 'string',
		short: 's',
		describe: 'Search a single file on the .grf or a list of files separated by comma. RegExp are supported. Combine with -o to extract only the matches.',
	},
	list: {
		type: 'boolean',
		short: 'l',
		describe: 'List files inside the grf.',
	},
	output: {
		type: 'string',
		short: 'o',
		describe: 'Output directoy to write the extracted files to.',
	},
	extract: {
		type: 'string',
		short: 'e',
		describe: 'Extract a single file from the .grf, prints to stdout. Example: grf-extractor -e data/clientinfo.xml > clientinfo.xml',
	},
	concurrency: {
		type: 'string',
		short: 'c',
		default: '100',
		describe: 'Concurrency rate, how many parallel extractions should we do, set it to higher values for a faster extraction.',
	},
	verbose: {
		type: 'boolean',
		short: 'v',
		describe: 'Enable verbose output, will print debug messages.',
	},
	version: {
		type: 'boolean',
		describe: 'Print package version.',
	},
	help: {
		type: 'boolean',
		short: 'h',
		describe: 'Print help and usage information',
	},
}

function showHelp() {
	console.error("Usage: grf-extractor -g data.grf -o output_dir")
	console.error("Options:")

	for(var name in options) {
		var opt = options[name]
		var flags = (opt.short ? '-' + opt.short + ', ' : '    ') + '--' + name
		var extra = typeof opt.default !== 'undefined' ? ' [default: ' + opt.default + ']' : ''

		console.error("  %s %s%s", flags.padEnd(18), opt.describe, extra)
	}
}

// Parse arguments
var arg

try {
	arg = parseArgs({ options: options, strict: true }).values
}
catch(err) {
	console.error(err.message)
	showHelp()
	process.exit(1)
}

// Print version
if(arg.version) {
	console.log(_package.version)
	return
}

// Print help
if(!arg.grf || arg.help) {
	showHelp()
	return
}

var concurrency = parseInt(arg.concurrency, 10)

if(!(concurrency > 0)) {
	console.error("Invalid concurrency '%s', must be a positive integer.", arg.concurrency)
	process.exit(1)
}

// Init working grf
var fd = Fs.openSync(arg.grf, 'r')

var grf = new Grf({
	fd: fd,
	size: Fs.fstatSync(fd).size,
})

// Set debugging mode
if(arg.verbose) {
	grf.printDebug = true
}

// Entries to extract, defaults to the whole grf
var entries = grf.entries

// Search and print information about a single file in the grf
// If an output dir is given, extract the matches instead
if(typeof arg.search === 'string') {
	var list = arg.search.split(',')
	var extractMatches = typeof arg.output === 'string'
	var selected = new Set()

	list.forEach(function(pattern) {
		var regexp

		try {
			regexp = new RegExp(pattern, 'i')
		}
		catch(err) {
			console.error("Invalid pattern %s: %s", pattern, err.message)
			process.exit(1)
		}

		grf.searchPattern(regexp, function(matches) {
			if(extractMatches) {
				matches.forEach(function(match) {
					if(match.type & Grf.FILELIST_TYPE_FILE) {
						selected.add(match)
					}
				})
				return
			}

			console.log("Search for %s:", pattern)

			if(matches.length === 0) {
				console.log("- Nothing found matching this pattern.")
				return
			}

			matches.forEach(function(match) {
				console.log("- File path: %s - File size: %d kb", match.path, match.real_size/1000)
			})
		})
	})

	if(!extractMatches) {
		return
	}

	// Keep grf order, so every cluster worker computes the same list
	entries = grf.entries.filter(function(entry) {
		return selected.has(entry)
	})

	if(entries.length === 0) {
		console.error("Nothing found matching %s.", arg.search)
		process.exit(1)
	}
}

// List files inside the grf
else if(arg.list) {
	grf.entries.forEach(function(file) {
		console.log("%s - size in bytes: %d", file.path, file.real_size)
	})

	return
}

// Extract a single file frm the grf
else if(typeof arg.extract === 'string') {
	var entry = grf.findEntry(arg.extract)
	var exists = entry !== null && grf.getFile(entry.filename, function(data){
		process.stdout.write(Buffer.from(data))
	})

	if(exists === false) {
		console.error("File '%s' not in the .grf, don't forget to put the data/ folder in front.", arg.extract)
		console.error("Example: -e data/clientinfo.xml")
		process.exit(1)
	}

	return
}

// Default action, extract the entire grf (or the search matches)
var extraction = grf.extract({
	output: (typeof arg.output !== 'string' ? '' : arg.output),
	entries: entries,
	concurrency: concurrency,
})

extraction.on('start', function() {
	console.log("Extraction has started on %d files.", entries.length)

	// Pretty progress bar extraction on process
	var bar = new ProgressBar('Progress [:current/:total] [:bar] :percent :elapseds - :etas', {
		width: 100,
		total: entries.length
	})
	var last = 0
	var timer = setInterval(function () {
		var progress = extraction.progress()
		var rate = progress - last

		last = progress

		bar.tick(rate)

		if (bar.complete) {
			console.log("Finished extracting GRF.")
			process.nextTick(process.exit)
		}
	}, 100)
})

extraction.on('error', function(err) {
	console.error("Extraction error", err)
})
