const ArgumentParser = require('argparse').ArgumentParser;
const _ = require('lodash');
const fs = require("fs");
const mkdirpsync = require("mkdirpsync");
const model = require('../src/model');
const path = require("path");
const pgformat = require('pg-format');
const process = require("process");
const rimraf = require('rimraf');
const uuidv4 = require('uuid/v4');
const os = require("os");
const async = require("async");

const TVDB = require('node-tvdb');
const tvdb = new TVDB("FVPW8O55SRM7SMNJ");

parser = new ArgumentParser({
  help: true, 
  description: "command line tool for uploading a video to plex"
});

parser.addArgument(
  'library',
  {
    help: 'the name of the library it belongs to',
  }
);

parser.addArgument(
  'originPath',
  {
    help: 'directory',
  }
);

const args = parser.parseArgs();
args.originPath = path.resolve(args.originPath);

const scanFiles = (dir, results) => {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullpath = path.join(dir, file);
    if (fs.lstatSync(fullpath).isDirectory()) {
      scanFiles(fullpath, results);
    } else {
      results.push(fullpath);
    }
  }
}

// mimetypes
const mimetypes = {
  ".mp4": "video/mp4",
  ".mpd": "application/dash+xml",
  ".m4s": "video/iso.segment",
  ".vtt": "text/vtt",
};

(async () => {
  // const series = await tvdb.getSeriesByName('Breaking Bad');
  // console.log(series[0].id);
  // const episodes = await tvdb.getEpisodesBySeriesId(series[0].id);
  // console.log(series);
  // console.log(episodes);

  await model.setup();

  const client = await model.getClient();
  try {
    /*
      decode path information for the media asset
    */
    const library = await model.getLibraryByName(args.library);
    if (library === null) {
      console.log("Error: no library with name '" + args.library + "'");
      console.log("Did you mean one of the following: ", (await model.getAllLibraries()).map((library) => {
        return library.libraryname;
      }));
      process.exit(1);
    }
    const libraryId = library.libraryid;
    console.log("LIBRARY TYPE: " + library.librarytype);

    let mediaName = null;
    let seriesName = null;
    let seasonNumber = null;
    let episodeNumber = null;

    if (library.librarytype === "tv") {
      const pathSegments = args.originPath.split("/").reverse();

      // find the series name
      for (const segment of pathSegments) {
        if (segment === pathSegments[0] || segment.toLowerCase().indexOf("season") !== -1)
          continue;
        seriesName = segment.trim();
        break;
      }

      const match = /.*S(\d+)E(\d+).*/.exec(pathSegments[0]);
      if (!match) {
        console.log("Error: could not extract Season or Episode number from path");
        process.exit(1);
      }
      seasonNumber = parseInt(match[1]);
      episodeNumber = parseInt(match[2]);

      mediaName = pathSegments[0].split(" ").filter((segment) => {
        return !segment.match(/.*p\.(mp4|mkv|flv|mov|webm)$/);
      }).join(" ");
    } else 
      throw new Error("no path parsing implemented for Movies at the moment");
    
    console.log("PARSED PATH INFORMATION");
    console.log("\tmedia name: " + mediaName);
    console.log("\tseries name: " + seriesName);
    console.log("\tseason number: " + seasonNumber);
    console.log("\tepisode number: " + episodeNumber);

    /*
      optionally transcode if necessary
    */
    console.log("checking the originPath: " + args.originPath);
    if (!fs.lstatSync(args.originPath).isFile()) {
      console.log("Fatal error: args.originalPath must be a file, transcoding is required");
      return ;
    }

    console.log("determined origin path is a file, we need to transcode.");
    const transcoder = require("../src/transcoder/transcoder"); // lazy import only if we need it
    
    uploadDir = path.join(os.tmpdir(), "/plex_uploader/" + uuidv4());
    console.log("upload directory " + uploadDir);
    mkdirpsync(uploadDir);

    const metadata = await transcoder({
      filename: args.originPath,
      outputdir: uploadDir
    });

    console.log("transcode completed! metadata: " + JSON.stringify(metadata, false, 3));

    /*
      scan files for upload 
    */

    let files = [];
    scanFiles(uploadDir, files);
    files = _.filter(files, (f) => {
      if (f.endsWith('.DS_Store'))
        return false;
      return true;
    }).map((value) => {
      return path.relative(uploadDir, value);
    });
    
    /*
      upload the media assets
    */
    await client.query("BEGIN");

    // creating a new media object
    const mediaId = uuidv4();
    await client.query(pgformat(`
      INSERT INTO media
      (mediaId, libraryId, name, originPath, metadata, seriesName, seasonNumber, episodeNumber)
      VALUES (%L, %L, %L, %L, %L, %L, %L, %L)
    `, mediaId, libraryId, mediaName,
       args.originPath, JSON.stringify(metadata),
       seriesName, seasonNumber, episodeNumber)
    );

    console.log("inserted new media with id: " + mediaId);

    const queue = async.queue((file, callback) => {
      const mimetype = mimetypes[path.extname(file)];
      if (!mimetype) {
        console.log("skipping file " + file + " mimetype not recognized.");
        return callback();
      }
      
      console.log(`uploading file ${file} with mimetype ${mimetype}`);
      const readStream = fs.createReadStream(path.join(uploadDir, file));
      model.putStreamObject(mediaId, file, readStream, client)
        .then((blockId) => {
          console.log(`\tuploaded ${file} to block ${blockId}`);
          callback();
        })
        .catch((err) => {
          console.log("\tencountered error uploading file: " + file);
          callback(err);
        });
    }, 4);

    for (const file of files) {
      queue.push(file);
    }

    console.log("waiting for the upload queue.");
    await queue.drain();
    console.log("upload queue drained.");
    
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    model.shutdown();

    if (uploadDir != args.originPath) {
      rimraf.sync(uploadDir);
    }
  }
})();