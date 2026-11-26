import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelHandler.Sharable;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.MultiThreadIoEventLoopGroup;
import io.netty.channel.epoll.EpollIoHandler;
import io.netty.channel.epoll.EpollServerSocketChannel;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import io.netty.handler.codec.LengthFieldPrepender;

/**
 * Length framed echo on Netty, the same pipeline as the netify server
 */
public final class Server {
  /**
   * Writes each frame back and flushes once per read batch
   */
  @Sharable
  static final class Echo extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext context, Object message) {
      context.write(message, context.voidPromise());
    }

    @Override
    public void channelReadComplete(ChannelHandlerContext context) {
      context.flush();
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext context, Throwable cause) {
      context.close();
    }
  }

  public static void main(String[] arguments) throws Exception {
    int port = Integer.parseInt(arguments[1]);
    int cores = Integer.parseInt(System.getenv().getOrDefault("BENCH_CORES", "1"));
    EventLoopGroup boss = new MultiThreadIoEventLoopGroup(1, EpollIoHandler.newFactory());
    EventLoopGroup workers = new MultiThreadIoEventLoopGroup(cores, EpollIoHandler.newFactory());
    Echo echo = new Echo();

    new ServerBootstrap()
        .group(boss, workers)
        .channel(EpollServerSocketChannel.class)
        .childOption(ChannelOption.TCP_NODELAY, true)
        .childHandler(
            new ChannelInitializer<SocketChannel>() {
              @Override
              protected void initChannel(SocketChannel channel) {
                channel
                    .pipeline()
                    .addLast(new LengthFieldBasedFrameDecoder(65536, 0, 4, 0, 4))
                    .addLast(new LengthFieldPrepender(4))
                    .addLast(echo);
              }
            })
        .bind("127.0.0.1", port)
        .sync();

    System.out.println("ready");
  }
}
