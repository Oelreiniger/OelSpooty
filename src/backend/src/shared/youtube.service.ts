import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { TrackService } from '../track/track.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as ffmpeg from 'fluent-ffmpeg';
import * as yts from 'yt-search';
import * as ytdl from '@distube/ytdl-core';
import { Readable } from 'stream';

const META_DATA_TITLE = '-metadata';
const YT_SETTINGS: ytdl.downloadOptions = {
  quality: 'highestaudio',
  filter: 'audioonly',
};

enum StreamStates {
  Finish = 'finish',
  Error = 'error',
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);

  constructor(private readonly configService: ConfigService) { }

  async findOnYoutubeOne(artist: string, name: string): Promise<string> {
    this.logger.debug(`Searching ${artist} - ${name} on YT`);
    const url = (await yts(`${artist} - ${name}`)).videos[0].url;
    this.logger.debug(`Found ${artist} - ${name} on ${url}`);
    return url;
  }

  downloadAndFormat(track: TrackEntity, folderName: string): Promise<void> {
    let path;
    this.logger.debug(`Downloading ${track.index} ${track.artist} - ${track.name} (${track.youtubeUrl}) from YT`);
    return new Promise((res, reject) => {
      ffmpeg(this.getYoutubeAudio(track.youtubeUrl, reject))
        .outputOptions(...this.getFfmpegOptions(track.name, track.artist))
        .format(this.configService.get<string>(EnvironmentEnum.FORMAT))
        .on(StreamStates.Error, (err) => reject(err))
        .pipe(
          fs
            .createWriteStream(
              path.join(
                path.dirname(folderName),
                `${track.index} - ${track.artist} - ${track.name}.${this.configService.get<string>(EnvironmentEnum.FORMAT)}`
              )
            )
            .on(StreamStates.Finish, () => {
              this.logger.debug(
                `Downloaded ${track.index} ${track.artist} - ${track.name} to ${folderName}`,
              );
              res();
            })
            .on(StreamStates.Error, (err) => reject(err)),
        );
    });
  }

  private getFfmpegOptions(name: string, artist: string): string[] {
    return [
      META_DATA_TITLE,
      `title=${name}`,
      META_DATA_TITLE,
      `artist=${artist}`,
    ];
  }

  private getYoutubeAudio(
    youtubeUrl: string,
    reject: (reason: any) => void,
  ): Readable {
    return ytdl(youtubeUrl, YT_SETTINGS).on(StreamStates.Error, (err) =>
      reject(err),
    );
  }
}
