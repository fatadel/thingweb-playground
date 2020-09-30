const SwaggerParser = require("swagger-parser")
const YAML = require("json-to-pretty-yaml")

module.exports = toOpenAPI

/**
 * Create an OpenAPI document from a Web of Things Thing Description
 * @param {object} td A Thing Description object as input
 * @returns {Promise<{json:object, yaml:String}|Error>} Resolves as object containing the OAP document or rejects
 */
function toOpenAPI(td) {
    return new Promise( (res, rej) => {
        /* required */
        const openapi = "3.0.3"
        const info = createInfo(td)
        const paths = crawlPaths(td)

        /* optional */
        const servers = crawlServers(td.base)
        const components = {}
        const security = {}
        const tags = addTags(td)
        const externalDocs = new ExternalDocs(
            "http://plugfest.thingweb.io/playground/",
            "This OAP specification was generated from a Web of Things (WoT) - Thing Description by the WoT Playground"
        )

        const API = {
            openapi,
            info,
            paths
        }
        if (servers.length > 0) {API.servers = servers}
        if (tags.length > 0) {API.tags = tags}


        SwaggerParser.validate(API).then( () => {
            res({json: API, yaml: YAML.stringify(API)})
        }, err => {
            console.log(JSON.stringify(API, undefined, 4))
            rej(err)
        })
    })
}

/* ####### FUNCTIONS #############*/

/**
 * Generate the root level openAPI general information
 * @param {object} td The input TD
 */
function createInfo(td) {
    const cInfo = {}
    // add title
    /* is required for valid TDs but in order to avoid testing constraints,
       TDs are not necessarily validated before OpenAPI generation
       e.g. test upcoming TD spec features */
    if (td.title !== undefined) {
        cInfo.title = td.title
    }
    else {
        cInfo.title = "Thing Description Playground autogenerated OpenAPI object"
    }

    // add version
    if (td.version && td.version.instance) {
        cInfo.version = td.version.instance
    }
    else {
        cInfo.version = "unknown"
    }

    // add description
    if (td.description !== undefined) {
        cInfo.description = td.description
    }

    // add support contact
    if (td.support) {
        if (td.support.startsWith("mailto:")) {
            cInfo.contact = {email: td.support.slice(7)}
        }
        else if (td.support.startsWith("http://") || td.support.startsWith("https://")) {
            cInfo.contact = {url: td.support}
        }
        else {
            cInfo.contact = {"x-uri": td.support}
        }
    }

    // add optional custom fields
    const tdOpts = ["@context", "@type", "created", "descriptions", "id", "links", "modified", "name", "titles"]
    tdOpts.forEach( prop => {
        if (td[prop] !== undefined) {
            cInfo["x-" + prop] = td[prop]
        }
    })

    return cInfo
}

function crawlPaths(td) {
    const cPaths = {}
    const interactions = ["properties", "actions", "events"]
    const httpBase = td.base && (td.base.startsWith("http://") || td.base.startsWith("https://")) ? true : false 


    // crawl Interaction Affordances forms
    interactions.forEach( interaction => {
        if (td[interaction] !== undefined) {

            // generate interactions tag
            const mapToSingular = {
                properties: "property",
                actions: "action",
                events: "event"
            }
            const tags = [mapToSingular[interaction]]            

            Object.keys(td[interaction]).forEach( interactionName => {

                const interactionInfo = genInteractionInfo(interaction, interactionName, td[interaction][interactionName], tags)

                td[interaction][interactionName].forms.forEach( form => {

                    // define type
                    const mapDefaults = {
                        properties: ["readproperty", "writeproperty"],
                        actions: "invokeaction",
                        events: []
                    }
                    const op = form.op ? form.op : mapDefaults[interaction]

                    addForm(form, interactionInfo, op)
                })
            })
        }
    })

    // crawl multiple Interaction forms at the root-level of the TD
    if (td.forms) {
        td.forms.forEach( form => {

            // generate interactions tag
            const tags = ["property"]
            // require op
            if (form.op) {
                const summary = (typeof form.op === "string") ? form.op : form.op.join(" ")
                const interactionInfo = {tags, summary}
                addForm(form, interactionInfo, form.op)
            }
        })
    }

    function genInteractionInfo(interaction, interactionName, tdInteraction, tags) {
        const interactionInfo = {tags, description: ""}
        const headline = "TD Interaction: " + interaction + interactionName

        // add title/headline
        if (tdInteraction.title) {
            interactionInfo.summary = tdInteraction.title
            interactionInfo.description += headline + "\n"
        }
        else {
            interactionInfo.summary = headline
        }

        // add description
        if (tdInteraction.description) {interactionInfo.description += tdInteraction.description}

        // add custom fields
        const tdOpts = ["descriptions", "titles"]
        tdOpts.forEach( prop => {
            if (tdInteraction[prop] !== undefined) {
                interactionInfo["x-" + prop] = tdInteraction[prop]
            }
        })

        return interactionInfo
    }

    function addForm(form, interactionInfo, myOp) {
        if (form.href.startsWith("http://") ||
            form.href.startsWith("https://") ||
            (httpBase && form.href.indexOf("://") === -1) ) {
            // add the operation
            const {path, server} = extractPath(form.href)

            // define the content type of the response
            let contentType
            if (form.response && form.response.contentType) {
                contentType = form.response.contentType
            }
            else { // if response is not defined explicitly use general interaction content Type
                if (form.contentType) {
                    contentType = form.contentType
                }
                else {
                    contentType = "application/json"
                }
            }

            // define content type of request
            let requestType
            if (form.contentType) {
                requestType = form.contentType
            }
            else {
                requestType = "application/json"
            }

            // define methods by htv-property or op-property
            let methods
            const htvMethods = ["GET", "PUT", "POST", "DELETE", "PATCH"]
            if (form["htv:methodName"] && htvMethods.some(htv => (htv === form["htv:methodName"]))) {
                methods = [form["htv:methodName"].toLowerCase()]
            }
            else {
                methods = recognizeMethod(myOp)
            }

            if (!cPaths[path] && methods.length > 0) {cPaths[path] = {}}

            addPaths(methods, path, server, contentType, requestType, interactionInfo)
        }
    }

    /**
     * Detect type of link and separate into server and path, e.g.:  
     * * Link `http://example.com/asdf/1`
     * * Server `http://example.com`
     * * Path `/asdf/1`
     * @param {string} link The whole or partial URL
     */
    function extractPath(link) {
        let server, path
        if (link.startsWith("http://")) {
            server = "http://" + link.slice(7).split("/").shift()
            path = "/" + link.slice(7).split("/").slice(1).join("/")
        }
        else if (link.startsWith("https://")) {
            server = "https://" + link.slice(8).split("/").shift()
            path = "/" + link.slice(8).split("/").slice(1).join("/")
        }
        else {
            path = link
            if (!path.startsWith("/")) {path = "/" + path}
        }
        return {path, server}
    }

    /**
     * Returns an array of http methods to describe e.g.: ["get", "put"]
     * @param {array} ops the op values e.g.: ["readproperty", "writeproperty"]
     */
    function recognizeMethod(ops) {
        const mapping = {
            readproperty: "get",
            writeproperty: "put",
            invokeaction: "post",
            readallproperties: "get",
            writeallproperties: "put",
            readmultipleproperties: "get",
            writemultipleproperties: "put"
        }

        const methods = []
        if (typeof ops === "string") {ops = [ops]}
        ops.forEach( op => {
            if(Object.keys(mapping).some( prop => prop === op)) {
                methods.push(mapping[op])
            }
        })

        return methods
    }

    /**
     * Create/Adapt the OAP Paths with the found path+server+methods combinations
     * @param {array} methods The methods found for this server&path combination
     * @param {string} path The path (e.g. /asdf/1)
     * @param {string} server The server (e.g. http://example.com)
     * @param {string} contentType The content type of the response (e.g. application/json)
     * @param {string} requestType The content type of the request (e.g. application/json)
     * @param {array} interactionInfo The interactionInfo associated to the form (one/some of Property, Action, Event)
     */
    function addPaths(methods, path, server, contentType, requestType, interactionInfo) {
        
        methods.forEach( method => {
            // check if same method is already there (e.g. as http instead of https version)
            if (cPaths[path][method]) {
                if (server) {
                    if (cPaths[path][method].servers) {
                        cPaths[path][method].servers.push(new Server(server))
                    }
                    else {
                        cPaths[path][method].servers = [new Server(server)]
                    }
                }
            }
            else {
                cPaths[path][method] = {
                    responses: {
                        default: {
                            description: "the default Thing response",
                            content: {
                                [contentType]: {}
                            }
                        }
                    },
                    requestBody: {
                        content: {
                            [requestType]: {}
                        }
                    }
                }
                Object.assign(cPaths[path][method], interactionInfo)

                // check if server is given (ain't the case for "base" url fragments) and add
                if (server) {
                    cPaths[path][method].servers = [new Server(server)]
                }
            }
        })
    }

    return cPaths
}

/**
 * Adds the base-server of the Thing if it exists
 * @param {String} base The base-url of the TD
 */
function crawlServers(base) {
    let cServers = []

    if (base !== undefined) {
        cServers.push(new Server(base, "TD base url"))
    }
    return cServers
}

/**
 * Generate OAP-tags for the TD Properties, Actions and Events
 * if the respective type of interaction is present in the input TD
 * @param {object} td The input TD
 */
function addTags(td) {
    const tags = []
    const interactions = {
        properties: {
            name: "property",
            description: "A property can expose a variable of a Thing, this variable might be readable, writable and/or observable.",
            externalDocs: new ExternalDocs("https://www.w3.org/TR/wot-thing-description/#propertyaffordance", "Find out more about Property Affordances.")
        },
        actions: {
            name: "action",
            description: "An action can expose something to be executed by a Thing, an action can be invoked.",
            externalDocs: new ExternalDocs("https://www.w3.org/TR/wot-thing-description/#actionaffordance", "Find out more about Action Affordances.")
        },
        events: {
            name: "event",
            description: "An event can expose a notification by a Thing, this notification can be subscribed and/or unsubscribed.",
            externalDocs: new ExternalDocs("https://www.w3.org/TR/wot-thing-description/#eventaffordance", "Find out more about Event Affordances.")
        }
    }
    Object.keys(interactions).forEach( interactionType => {
        if (td[interactionType] !== undefined) {
            tags.push(interactions[interactionType])
        }
    })
    return tags
}


/* ##### CONSTRUCTORS ############ */
function Server(url, description, variables) {
    if (url === undefined) {throw new Error("url for server object missing")}
    this.url = url
    if (description) {this.description = description}
    if (variables) {this.variables = variables}
}

function ExternalDocs(url, description) {
    if (url === undefined) {throw new Error("url for external docs object missing")}
    this.url = url
    if (description) {this.description = description}
}
