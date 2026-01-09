import express from "express";
import fetch from "node-fetch";
import { Dropbox } from "dropbox";
import cors from "cors";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(cors());
const upload = multer(); // in-memory storage

const hostname = "localhost";
const port = 3000;

const dbx = new Dropbox({
  fetch,
  clientId: "", // app key only,
});

const redirectUri = `http://${hostname}:${port}/auth`;

app.use(express.static("public"));

app.get("/allow", async (req, res) => {
  try {
    const authUrl = await dbx.auth.getAuthenticationUrl(
      redirectUri,
      null,
      "code",
      "offline",
      null,
      "none",
      true // PKCE enabled
    );

    res.redirect(authUrl);
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to start auth");
  }
});

app.get("/auth", async (req, res) => {
  const { code } = req.query;
  console.log("code:", code);

  try {
    const token = await dbx.auth.getAccessTokenFromCode(redirectUri, code);

    dbx.auth.setRefreshToken(token.result.refresh_token);

    console.log("TOKEN", token.result);

    res.send("Dropbox connected — you can close this window.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Auth failed");
  }
});

app.post("/upload", upload.single("projectFile"), async (req, res) => {
  try {
    // file buffer from somewhere
    const { lesson, name, title, description } = req.body;
    const file = req.file; // <-- file comes here
    //  const file = req.file;

    const result = await dbx.filesUpload({
      path: `/${lesson}/example.sb3`, // Dropbox path
      contents: file.buffer,
      mode: "add", // don't overwrite
      autorename: true,
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Upload failed");
  }
});

app.post("/folders", async (req, res) => {
  const { path } = req.body;

  try {
    const result = await dbx.filesListFolder({
      path,
      recursive: false,
    });

    // keep only folders
    const folders = result.result.entries
      .filter((entry) => entry[".tag"] === "folder")
      .map((folder) => folder.name);

    res.json({ folders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read folders" });
  }
});

app.post("/files", async (req, res) => {
  const { path } = req.body;

  try {
    const result = await dbx.filesListFolder({
      path,
      recursive: false,
    });

    // keep only folders
    const folders = result.result.entries
      .filter((entry) => entry[".tag"] === "file")
      .map((folder) => folder.name);

    res.json({ folders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read folders" });
  }
});

app.post("/get_json", async (req, res) => {
  const { lesson } = req.body;

  try {
    const download = await dbx.filesDownload({
      path: `/GoAI-Test/${lesson}/index.json`,
    });

    const text = Buffer.from(download.result.fileBinary).toString("utf-8");

    const data = JSON.parse(text);

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

app.post("/edit_json", upload.single("projectFile"), async (req, res) => {
  const { lesson, name, title, description } = req.body;
  const file = req.file; // <-- file comes here

  try {
    const upload = await dbx.filesUpload({
      path: `/GoAI-Test/${lesson}/${name}.sb3`,
      contents: file.buffer,
      mode: "add",
      autorename: true,
    });

    let sharedUrl;

    try {
      const shared = await dbx.sharingCreateSharedLinkWithSettings({
        path: upload.result.path_lower,
        settings: {
          requested_visibility: "public",
        },
      });

      sharedUrl = shared.result.url;
    } catch (err) {
      if (err?.error?.error_summary?.includes("shared_link_already_exists")) {
        const links = await dbx.sharingListSharedLinks({
          path: upload.result.path_lower,
          direct_only: true,
        });

        sharedUrl = links.result.links[0].url;
      } else {
        throw err;
      }
    }

    let data;
    let filePath;

    try {
      filePath = `/GoAI-Test/${lesson}/index.json`;
      const download = await dbx.filesDownload({ path: filePath });

      const text = Buffer.from(download.result.fileBinary).toString("utf-8");

      data = JSON.parse(text);
      data.push({
        timestamp: new Date().toISOString(),
        name,
        title,
        description,
        downloadUrl: sharedUrl,
      });
    } catch (err) {
      if (err?.error?.error_summary?.includes("path/not_found")) {
        data = [];
      } else {
        throw err;
      }
    }

    await dbx.filesUpload({
      path: filePath,
      mode: "overwrite",
      autorename: false,
      contents: JSON.stringify(data, null, 2),
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read folders" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://${hostname}:${port}`);
});
