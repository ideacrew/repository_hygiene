const { Octokit } = require("@octokit/rest");
const core = require("@actions/core");

const BATCH_SIZE = 50;
const BATCH_LIMIT = 400;

const ENVIRONMENT = process.env;

const GITHUB_TOKEN = ENVIRONMENT.GITHUB_TOKEN;
const repository = ENVIRONMENT.REPOSITORY;
const beforeDateArg = ENVIRONMENT.BEFORE_DATE;

if(typeof repository != "string") {
  throw new Error(`The repository input parameter '${repository}' is not in the format {owner}/{repo}.`);
}

if(typeof beforeDateArg != "string") {
  throw new Error(`The before date input parameter '${beforeDateArg}' is invalid.`);
}

const ownerAndRepo = repository.split("/");
if(ownerAndRepo.length !== 2){
  throw new Error(`The repository input parameter '${repository}' is not in the format {owner}/{repo}.`);
}

const owner = ownerAndRepo[0];
const repoName = ownerAndRepo[1];

const dateCriteria = `<${beforeDateArg}`;

function requestWorkflowBatch(kit, owner, repo, dateQuery) {
  return kit.rest.actions.listWorkflowRunsForRepo({
    owner: owner,
    repo: repo,
    created: dateQuery,
    per_page: BATCH_SIZE
  });
};

async function deleteWorkflowRun(kit, owner, repo, run) {
  let deleteParameters = {
    owner: owner,
    repo: repo,
    run_id: run.id
  };

  let { status } = await kit.actions.deleteWorkflowRun(deleteParameters);

  if(status == 204) {
    core.debug(`Deleted workflow run ${run.id}.`)
  } else {
    const err = new Error(`Something went wrong while deleting workflow "${run.head_commit.message}" with ID:${run.id}. Status code: ${status}`);
    core.error(err);
    throw err;
  }
}

async function doParaDelete(kit, owner, repo, runs) {
  let head = runs.slice(0,2);
  let rest = runs.slice(2,-1);
  while (head.length > 0) {
    let headValues = [];
    for (const run of head) {
      headValues.push(deleteWorkflowRun(kit, owner, repo, run));
    }
    await Promise.allSettled(headValues);

    head = rest.slice(0,2);
    rest = rest.slice(2,-1);
  }
}

async function main(owner, repo, beforeDate) {

  const octokit = new Octokit({
    auth: GITHUB_TOKEN
  });

  core.info(`Requesting ${BATCH_SIZE} initial workflows.`);
  let workflow_response = await requestWorkflowBatch(octokit, owner, repo, beforeDate);

  let runs = workflow_response.data.workflow_runs;

  core.info(`Found ${runs.length} initial workflows.`);

  let count = 0;

  while (runs.length > 0) {
    if ((runs.length + count) >= BATCH_LIMIT) {
      let remainder = BATCH_LIMIT - count;
      let toProcess = runs.slice(0, remainder);
      await doParaDelete(octokit, owner, repo, toProcess);
      core.notice(`Processed ${count + remainder} total workflows.`, {file: "workflow_cleanup/main.js"});
      core.warning(`We currently limit batch cleanup to ${BATCH_LIMIT} at a time - and we've hit it.`);
      return ;    
    } else {
      await doParaDelete(octokit, owner, repo, runs);
      count = count + runs.length;
    }
    core.info(`Requesting ${BATCH_SIZE} more workflows.`);
    workflow_response = await requestWorkflowBatch(octokit, owner, repo, beforeDate);
    runs = workflow_response.data.workflow_runs;
    core.info(`Found ${runs.length} more workflows.`);
  }
  core.notice(`Processed ${count} total workflows.`, {file: "workflow_cleanup/main.js"});
};

main(owner, repoName, dateCriteria);
