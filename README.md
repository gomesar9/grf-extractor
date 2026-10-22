Grf-extractor
=========

This is a command line tool for extracting and handling .grf packages.

GRF files are a set of packed and compressed files, normally found on Ragnarok's game files.

Install
=========
Requires Node.js >= 20.
```
npm install -g grf-extractor
```

Usage
====
```
Usage: grf-extractor -g data.grf -o output_dir
Options:
  -g, --grf          The grf file to be worked on.
  -s, --search       Search a single file on the .grf or a list of files separated by comma. RegExp are supported. Combine with -o to extract only the matches.
  -l, --list         List files inside the grf.
  -o, --output       Output directoy to write the extracted files to.
  -e, --extract      Extract a single file from the .grf, prints to stdout. Example: grf-extractor -e data/clientinfo.xml > clientinfo.xml
  -c, --concurrency  Concurrency rate, how many parallel extractions should we do, set it to higher values for a faster extraction. [default: 100]
  -v, --verbose      Enable verbose output, will print debug messages.
      --version      Print package version.
  -h, --help         Print help and usage information
```

Paths can be written with `/` or `\`, and are matched case-insensitively. Korean (CP949) file names are decoded to UTF-8.

Extract only the files matching a pattern:
```
grf-extractor -g data.grf -s "data/wav/EF_hit" -o ./sons_extraidos
```

TODO
======
* Support writting files to the grf.
* Standardize the API.
* Refactor `extractor.js`.
