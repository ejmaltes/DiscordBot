CREATE DATABASE IF NOT EXISTS "spotify-bot";

USE "spotify-bot";

DROP TABLE IF EXISTS song;

CREATE TABLE song(
  id serial NOT NULL PRIMARY KEY,
  spotify_query VARCHAR(255) NOT NULL UNIQUE,
  youtube_link VARCHAR(255) NOT NULL UNIQUE
);
