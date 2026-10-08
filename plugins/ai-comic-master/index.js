module.exports = {
  apply(ctx) {
    ctx.logger.info('AI 漫剧大师后端核心已成功挂载！');
    ctx.registerService('aiComicService', {
      async renderVideo(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt : '';
        ctx.logger.info(`收到渲染请求，提示词: ${prompt}`);
        return { success: true, videoPath: '/outputs/demo.mp4', prompt };
      },
    });
  },

  dispose() {
    console.log('AI 漫剧大师已回收所有计算资源。');
  },
};
