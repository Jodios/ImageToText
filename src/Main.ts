import { createWorker, createScheduler } from "tesseract.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import os from "os";

// each iteration downloads 100 posts. Not all have images
const iterations = 10;

var workers: Tesseract.Worker[] = [];
const numberOfWorkers = os.cpus().length;
const scheduler = createScheduler();

var lowerDateRange: Date = new Date("12/29/2020")
var laterDateRange: Date = new Date("12/30/2020")
const day = 1000 * 60 * 60 * 24;
var url = `https://api.pushshift.io/reddit/search/submission/?subreddit=greentext&sort=desc&sort_type=created_utc&size=1000&after=${lowerDateRange.getTime() / 1000}&before=${laterDateRange.getTime() / 1000}`;

const pathToImages = path.join(__dirname, "resources");
const pathToText = path.join(__dirname, "greentext_output");
var imagePaths: Object[] = [];
if (!fs.existsSync(pathToImages))
    fs.mkdirSync(pathToImages);
if (!fs.existsSync(pathToText))
    fs.mkdirSync(pathToText);

/**
 * Setting up the workers
 */
for (var i = 0; i < numberOfWorkers; i++) {
    workers.push(createWorker());
}

/**
 * This method is using tesseract to read the images
 * and extract the text from them. Text files are stores in
 * src/greentext_output
 * @param imageNamesAndLinks List of all image paths in the format C:/imageToText/src/resources/img.jpg
 */
const parseImages = async (imageNamesAndLinks: Object[]) => {
    if (imageNamesAndLinks.length == 0) {
        console.log("NO IMAGES TO PARSE");
        return;
    }

    for (var i = 0; i < workers.length; i++) {
        await workers[i].load();
        await workers[i].loadLanguage('eng');
        await workers[i].initialize('eng');
        scheduler.addWorker(workers[i]);
    }

    return Promise.all(
        imageNamesAndLinks.map(async (imageObj) => {
            console.log(`==============Parsing ${imageObj['url']}`);
            return await scheduler.addJob('recognize', imageObj['url']).then(result => {
                let text = result.data.text.replace(/^\s*[\r\n]/gm, "");
                let textFile = imageObj['name'].split(".")[0] + ".txt";
                fs.writeFile(path.join(pathToText, textFile), text, (err) => {
                    console.log("=======================ERROR=======================")
                    console.log(`ERROR WRITING ${textFile}: \n\t\t${err}`)
                    console.log("=====================END_ERROR=====================")
                });
            }).catch(err => {
                console.log("=======================ERROR=======================")
                console.log(`error parsing ${imageObj['name']}: \n\t\t${err}`)
                console.log("=====================END_ERROR=====================")
            });
        })
    );
}

/**
 * Getting all posts from from r/greentext.
 * After all posts are collected, they are passed into {@method downloadPics}
 * to download images
 */
const getPosts = async (): Promise<Object[]> => {
    return new Promise((resolve, reject) => {
        axios.get(url).then(async (response) => {
            let data: Object[] = response.data.data;
            resolve(data);
        }).catch(async (err) => {
            reject(`===========================ERROR GETTING AN IMAGE. WILL PARSE THE SUCCESSFUL ONES: \n${err}\n===========================`)
        });
    });
}

/**
 * This method iterates through every post provided by {@method getPosts}
 * and gets 'url' property from them if they exist and attempts to download the
 * image and passes the downloaded bytes to {@method writeImagesToFile}
 * @param posts List of a post object 
 */
const downloadPics = async (posts: Object[]): Promise<Object[]> => {
    return Promise.all(posts.map(async (post) => {
        if (!post['url'] || !post['url'].includes("i.redd.it")) return;
        let type = post['url'].split(".")[3];
        let name = (post['url'].split(".")[2]).split("/")[1];
        let fullname = name + "." + type;
        let imagePath = path.join(pathToImages, fullname);
        if (type && !fs.existsSync(imagePath) && post['url']) {
            return { stream: await axios.get(post['url'], { responseType: "stream" }).catch(err => console.log("ERR")), imagePath }
        }
    }))
}

/**
 * This method takes a stream of bytes and pipes it into an image file
 * in {@constant pathToImages} and waits 5 seconds to make sure the files
 * have been properly written to.
 * @param imageStreams List of objects {stream: stream of bytes that make up image, imagePath: path to image}
 */
const writeImagesToFile = async (imageStreams: Object[]) => {
    return new Promise((resolve, reject) => {
        imagePaths = []
        if (!imageStreams || imageStreams.length == 0) resolve;
        imageStreams.forEach(stream => {
            //@ts-ignore
            if (!stream || !stream.stream) return;
            //@ts-ignore
            let imagePath: string = stream.imagePath;
            //@ts-ignore
            if (!fs.existsSync(path.join(pathToText, path.basename(imagePath).split(".")[0] + "." + ".txt")))
                imagePaths.push({ url: imagePath, name: path.basename(imagePath) });
            //@ts-ignore
            stream.stream.data.pipe(fs.createWriteStream(imagePath));
        })
        setTimeout(resolve, 5000);
    });
}


const start = async () => {
    for (var i = 0; i < iterations; i++) {

        console.log(lowerDateRange);
        console.log(laterDateRange);
        console.log(url);
        let data: Object[] = await getPosts();
        let imageStreams: Object[] = await downloadPics(data);
        await writeImagesToFile(imageStreams);
        await parseImages(imagePaths);
        lowerDateRange = new Date(lowerDateRange.getTime() - day);
        laterDateRange = new Date(laterDateRange.getTime() - day);
        url = `https://api.pushshift.io/reddit/search/submission/?subreddit=greentext&sort=desc&sort_type=created_utc&size=1000&after=${lowerDateRange.getTime() / 1000}&before=${laterDateRange.getTime() / 1000}`;

    }
}

start();