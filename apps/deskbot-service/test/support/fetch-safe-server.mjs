const realFetch=globalThis.fetch;

export async function closeTestServer(server) {
  if(!server?.listening)return;
  await new Promise((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
    server.closeAllConnections?.();
  });
}

// Windows can allocate a dynamic port blocked by Fetch and WebSocket before
// any connection reaches the server. Preflight that transport only; retries
// never run a test callback, assertion, chat turn or protocol message twice.
export async function listenOnFetchSafePort(createServer,{fetchImpl=realFetch,maxAttempts=8}={}) {
  for(let attempt=0;attempt<maxAttempts;attempt++) {
    const server=createServer();
    const fallback=(request,response)=>{
      // Upgrade-only test servers have no HTTP request handler. An existing
      // application's handler has already handled its own unknown route.
      if(request.url==='/__test_port_preflight__'&&!response.writableEnded)response.writeHead(204).end();
    };
    server.on('request',fallback);
    try {
      await new Promise((resolve,reject)=>{
        const onError=error=>{server.removeListener('listening',onListening);reject(error);};
        const onListening=()=>{server.removeListener('error',onError);resolve();};
        server.once('error',onError);server.once('listening',onListening);server.listen(0,'127.0.0.1');
      });
      const address=server.address();
      if(!address||typeof address!=='object')throw Error('Test server has no TCP address');
      const baseUrl=`http://127.0.0.1:${address.port}`;
      try {
        const response=await fetchImpl(`${baseUrl}/__test_port_preflight__`,{signal:AbortSignal.timeout(3000)});
        await response.arrayBuffer();
      }catch(error) {
        if(error?.cause?.message==='bad port') {await closeTestServer(server);continue;}
        throw error;
      }
      return {server,baseUrl};
    }catch(error) {
      await closeTestServer(server);throw error;
    }finally {server.removeListener('request',fallback);}
  }
  throw Error('Unable to allocate a local test port accepted by Fetch');
}
