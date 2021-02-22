import { createWorker, createScheduler } from "tesseract.js";
import fs from "fs";
import path from "path";
import axios from "axios";

var workers: Tesseract.Worker[] = [];
const numberOfWorkers = 20;
const scheduler = createScheduler();
const pathToImages = path.join(__dirname, "resources");
const pathToText = path.join(__dirname, "greentext_output");
const imagesToDownload = 1000;
let imagePaths: Object[] = [];

const url = `https://api.pushshift.io/reddit/search/submission/?subreddit=greentext&sort=desc&sort_type=created_utc&size=${imagesToDownload}`;
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

const asyncForEach = async (array: any[], callback) => {
    for(let i = 0; i < array.length; i++){
        await callback(array[i], i, array);
    }
}

/**
 * This method is using tesseract to read the images
 * and extract the text from them. Text files are stores in
 * src/greentext_output
 * @param imageNamesAndLinks List of all image urls in the format {url: http://link.com, name: myImage.jpg}
 */
const parseImages = async (imageNamesAndLinks: Object[]) => {
    if (imageNamesAndLinks.length == 0) {
        console.log("NO IMAGES TO PARSE");
        return;
    }

    await asyncForEach(workers, async (worker) => {
    
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        scheduler.addWorker(worker);

    })

    Promise.all(
        imageNamesAndLinks.map(async (imageObj) => {
            console.log(`==============Parsing ${imageObj['url']}`);
            return { result: await scheduler.addJob('recognize', imageObj['url']).then(result => {
                let text = result.data.text.replace(/^\s*[\r\n]/gm, "");
                fs.writeFile(path.join(pathToText, imageObj['name'].split(".")[0] + ".txt"), text, (err) => console.log(err));
            }), imageName: imageObj['name'] };
        })
    ).then(results => {
        console.log("DONE");
    }).catch(err => {
        console.log(`ERROR IN PARSING IMAGE:\n err:${err}`);
    });

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

const downloadPics = async (data: Object[]): Promise<Object[]> => {
    return Promise.all(data.map(async (x) => {
        if (!x['url'] || !x['url'].includes("i.redd.it")) return;
        let type = x['url'].split(".")[3];
        let name = (x['url'].split(".")[2]).split("/")[1];
        let fullname = name + "." + type;
        let imagePath = path.join(pathToImages, fullname);
        if (type && !fs.existsSync(imagePath) && x['url']) {
            return {stream:await axios.get(x['url'], { responseType: "stream" }).catch(err => console.log("ERR")), imagePath}
        }
    }))
}

const writeImagesToFile = async (imageStreams: Object[]) => {
    return new Promise((resolve, reject) => {
        if(!imageStreams || imageStreams.length == 0) resolve;
        imageStreams.forEach(stream => {
            //@ts-ignore
            if(!stream || !stream.stream) return;
            //@ts-ignore
            let imagePath: string = stream.imagePath;
            //@ts-ignore
            if(!fs.existsSync(path.join(pathToText, path.basename(imagePath).split(".")[0]+"."+".txt")))
                imagePaths.push({url:imagePath, name: path.basename(imagePath)});
            //@ts-ignore
            stream.stream.data.pipe(fs.createWriteStream(imagePath));
        })
        setTimeout(resolve, 5000);
    })
}

const start = async () => {
    let data: Object[] = await getPosts();
    let imageStreams: Object[] = await downloadPics(data);
    await writeImagesToFile(imageStreams);
    parseImages(imagePaths);
}

start();