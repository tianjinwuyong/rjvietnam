BEGIN;

CREATE TABLE IF NOT EXISTS training_videos (
  id                bigserial PRIMARY KEY,
  video_code        varchar(80) NOT NULL,
  title_zh          varchar(240) NOT NULL,
  title_en          varchar(240),
  title_vi          varchar(240),
  business_domain   varchar(40) NOT NULL,
  topic_code        varchar(80) NOT NULL,
  station_code      varchar(80),
  language_code     varchar(10) NOT NULL DEFAULT 'zh-CN',
  version_no        integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  file_url          text NOT NULL,
  thumbnail_url     text,
  mime_type         varchar(80) NOT NULL DEFAULT 'video/mp4',
  duration_seconds  integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  tags              jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            varchar(20) NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  uploaded_by       bigint REFERENCES users(id),
  approved_by       bigint REFERENCES users(id),
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_code, language_code, version_no)
);

CREATE INDEX IF NOT EXISTS idx_training_videos_topic
  ON training_videos(business_domain, topic_code, status, language_code);
CREATE INDEX IF NOT EXISTS idx_training_videos_station
  ON training_videos(station_code, status) WHERE station_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS training_video_page_links (
  id          bigserial PRIMARY KEY,
  video_id    bigint NOT NULL REFERENCES training_videos(id) ON DELETE CASCADE,
  route_key   varchar(120) NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, route_key)
);

CREATE INDEX IF NOT EXISTS idx_training_video_page_links_route
  ON training_video_page_links(route_key, sort_order);

INSERT INTO _migrations(filename, hash)
VALUES ('170_training_video_center.sql', 'training-video-center-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
