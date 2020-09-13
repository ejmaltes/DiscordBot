const Discord = require("discord.js");
const ytdl = require("ytdl-core");
var querystring = require('querystring');
const fetch = require("node-fetch");
const btoa = require("btoa");
const client = new Discord.Client();
const form = require('form-urlencoded').defualt;
const request = require('request-promise');
const db = require('./db');
const sql = require('yesql').pg;
const fs = require('fs');


/** If cloning you'll need to replace all of these with your own credentials **/
const DISCORD_SECRET = fs.readFileSync('./secrets/discord_secret.txt').toString();
const GOOGLE_SECRETS = fs.readFileSync('./secrets/google_secrets.txt', { encoding: 'utf8' }).split('\n');
const SPOTIFY_FILE = fs.readFileSync('./secrets/spotify_secrets.txt', { encoding: 'utf8' }).split('\n');
const SPOTIFY_CLIENT_ID = SPOTIFY_FILE[0];
const SPOTIFY_CLIENT_SECRET = SPOTIFY_FILE[1];

const SPOTIFY_REDIRECT_URI = "https://www.spotify.com/us/";
const SPOTIFY_SCOPES = "user-read-private user-read-email user-read-playback-state"
const prefix = "!";

let servers = {}

let current_key = 0;

//**************** YOUTUBE API ****************//
async function searchYoutube(query) {
  let rows = await checkDatabase(query);
  if (rows.length > 0) {
    return rows[0].youtube_link;
  }
  console.log("Querying Youtube for " + query);
  let url = "https://www.googleapis.com/youtube/v3/search?part=snippet&q="
                + query + "&key=" + GOOGLE_SECRETS[current_key % GOOGLE_SECRETS.length] + "&maxResults=3";
  try {
    let response = await fetch(url);
    if (response.status == 403) {
      current_key += 1;
      return searchYoutube(query);
    }
    let json = await response.json();

    let video_url = "https://www.youtube.com/watch?v=" + json.items[0].id.videoId;

    return video_url;
  } catch(e) {
    console.error(e);
  }
}
//**************** YOUTUBE API ****************//

//**************** SPOTIFY API ****************//
async function getSpotifyToken() {
  let options = {
    method: "POST",
    uri: "https://accounts.spotify.com/api/token",
    form: {
      grant_type: "client_credentials"
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET)
    }
  };

  let response = await request(options);
  let json = JSON.parse(response);
  return json.access_token;
}

async function fetchPlaylist(id) {
  let token = await getSpotifyToken();
  let response = await fetch("https://api.spotify.com/v1/playlists/" + id, {
    headers: {
      "Authorization": "Bearer " + token
    }
  });
  let json = await response.json();
  let tracks = json.tracks.items;
  let songs = [];
  for (let track of tracks) {
    let name = track.track.name;
    let artist = track.track.artists[0].name;
    songs.push(name + " " + artist);
  }
  return songs;
}
//**************** SPOTIFY API ****************//

//**************** POSTGRES ****************//
async function checkDatabase(query) {
  let db_query = "SELECT youtube_link FROM song WHERE spotify_query='" + query + "'";
  let { rows } = await db.query(db_query);
  return rows;
}
//**************** POSTGRES ****************//

function play(connection, message) {
  let server = servers[message.guild.id];
  current_stream = ytdl(server.queue[0], {
    filter: "audioonly",
    highWaterMark: 1<<25
  });
  server.dispatcher = connection.play(current_stream);
  server.queue.shift();

  server.dispatcher.on("finish", function() {
    if(server.queue[0]) {
      play(connection, message);
    } else {
      connection.disconnect();
    }
  })
}


client.once("ready", () => {
  console.log("Bot online");
})

client.on("message", async message => {
  if(!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).split(/ +/);

  const command = args.shift().toLowerCase();


  if(command === "play") {

    if(!args[0]) {
      let server = servers[message.guild.id];
      if (server && server.dispatcher && server.dispatcher.paused) {
        server.dispatcher.resume();
      } else {
        message.channel.send("You need to provide a link");
        return;
      }
    }

    if(!message.member.voice.channel) {
      message.channel.send("You must be in a channel to play the bot!");
      return;
    }

    if(!servers[message.guild.id]) {
      servers[message.guild.id] = {
        queue: []
      };
    }

    let server = servers[message.guild.id];
    let query = args.join(" ");
    server.queue.push(await searchYoutube(query));

    if(!message.guild.voice) message.member.voice.channel.join().then(function(connection) {
      play(connection, message);
    })
  }

  if (command === "skip") {
    let server = servers[message.guild.id];
    if (message.guild.voice.connection) {
      server.dispatcher.pause();
    }

    if(server.queue.length > 0) {
      play(message.guild.voice.connection, message);
    } else {
      message.guild.voice.connection.disconnect();
    }
    message.channel.send("Skipping the song!");
  }

  if (command === "stop") {
    let server = servers[message.guild.id];
    if(message.guild.voice.connection) {
      for (let i = server.queue.length - 1; i <= 0; i++) {
        server.queue.splice(i, 1);
      }

      server.dispatcher.end();
      console.log("Stopped the queue");
      message.channel.send("Leaving voice channel...")
      if (message.guild.voice.connection) {
        message.guild.voice.connection.disconnect();
      }
    }
  }

  if (command === "pause") {
    let server = servers[message.guild.id];
    if (message.guild.voice.connection) {
      server.dispatcher.pause();
    }
  }

  if (command === "playlist") {
    if (!args[0]) {
        message.channel.send("You need to provide a link");
        return;
      }

    if (!message.member.voice.channel) {
      message.channel.send("You must be in a channel to play the bot!");
      return;
    }

    if (!servers[message.guild.id]) {
      servers[message.guild.id] = {
        queue: []
      };
    }

    let server = servers[message.guild.id];
    server.queue = [];
    let id = args[0].substring(args[0].lastIndexOf(":") + 1);
    let songs = await fetchPlaylist(id);
    for (let song of songs) {
      let youtube_link = await searchYoutube(song);
      let rows = await checkDatabase(song);
      if (rows.length === 0) {
        let query = "INSERT INTO song(spotify_query, youtube_link) VALUES(:song, :link)"
        await db.query(sql(query)({
          song: song,
          link: youtube_link
        }));
      }
      server.queue.push(youtube_link);
      
      if (!message.guild.voice) message.member.voice.channel.join().then(function(connection) {
        play(connection, message);
      })
    }
  }

  if (command === "commands") {
    messages = [
      "!play and !skip - works like rythm",
      "!pause - ...pauses",
      "!stop - clears queue and makes bot leave",
      "!playlist {spotify uri} - plays spotify playlist (e.g. !playlist spotify:playlist:37i9dQZF1DX6drTZKzZwSo)",
      "Right now it can only play about 300 songs per day... keep that in mind"
    ];
    for (let text of messages) {
      message.channel.send(text);
    }
  }

})

client.login(DISCORD_SECRET);
