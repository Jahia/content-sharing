package org.jahia.se.modules.contentSharing;

import org.apache.commons.lang3.StringUtils;
import org.apache.jackrabbit.util.Text;
import org.jahia.bin.Render;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.content.*;
import org.jahia.services.content.decorator.JCRSiteNode;
import org.jahia.services.render.*;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.jahia.api.Constants;

import javax.jcr.Binary;
import javax.jcr.PathNotFoundException;
import javax.jcr.RepositoryException;
import javax.jcr.query.Query;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletRequestWrapper;
import javax.servlet.http.HttpServletResponse;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import org.jahia.api.Constants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(service = {javax.servlet.http.HttpServlet.class, javax.servlet.Servlet.class}, property = {"alias=/share", "allow-api-token=true"})
public class ContentSharingServlet extends HttpServlet {
    private static final Logger LOGGER = LoggerFactory.getLogger(ContentSharingServlet.class);

    private static final String KEY_PROPS = "se:sharedUrl";
    private JCRTemplate jcrTemplate;
    private RenderService renderService;

    @Reference
    public void setJcrTemplate(JCRTemplate jcrTemplate) {
        this.jcrTemplate = jcrTemplate;
    }

    @Reference
    public void setRenderService(RenderService renderService) {
        this.renderService = renderService;
    }

    @Activate
    public void activate(Map<String, Object> config) {}

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        Map<String,String> parameters = Utils.getDecodedParams(request.getQueryString());
        String contentKey = parameters.get("c");
        String contentType = parameters.get("t");
        String languageTag = parameters.get("l");

        Locale locale = Locale.ENGLISH;
        if(!StringUtils.isBlank(languageTag)){
            locale = Locale.forLanguageTag(languageTag);
        }
//        String contentKey = request.getParameter("c");
//        String contentType = request.getParameter("t");

        // Set the response content type
        response.setContentType("text/html");

        try {
            // Write response
            response.getWriter().println(jcrTemplate.doExecuteWithSystemSessionAsUser(null, Constants.LIVE_WORKSPACE, locale, new JCRCallback<String>() {
                    @Override
                    public String doInJCR(JCRSessionWrapper session) throws RepositoryException {
                        JCRNodeIteratorWrapper iteratorWrapper =  session.getWorkspace()
                                .getQueryManager()
                                .createQuery("SELECT * FROM ["+contentType+"] AS node WHERE node.["+KEY_PROPS+"] = '"+contentKey+"'", Query.JCR_SQL2)
                                .execute()
                                .getNodes();
                        if(iteratorWrapper.hasNext()){
                            JCRNodeWrapper node = (JCRNodeWrapper) iteratorWrapper.next();

    //                        session.getNodeByIdentifier(node.getIdentifier())
                            if(node.isNodeType(Constants.JAHIANT_FILE)){
                                return renderFile(node,request,response);
                            }else{
                                return renderContent(node,request,response);
                            }


                        }
                        return "<h1>Oups nothing to display</h1>";
                    }
                })
            );
        } catch (RepositoryException e) {
            // Write response
            response.getWriter().println("<h1>Oups something wrong</h1>");
            LOGGER.error("Error retrieving site from node", e);
        }


    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        // Handle POST requests here
    }

    private String renderContent (JCRNodeWrapper node,HttpServletRequest request, HttpServletResponse response) throws RepositoryException {
        Resource r = new Resource(node, "html", "default", "page");
        RenderContext localRenderContext = new RenderContext(unwrapRequest(request), response, JCRSessionFactory.getInstance().getCurrentUser());                            localRenderContext.setMainResource(r);
        localRenderContext.setEditMode(false);
        localRenderContext.setWorkspace(Constants.LIVE_WORKSPACE);
        localRenderContext.setServletPath(Render.getRenderServletPath());
//                            localRenderContext.setServletPath("/cms/render");
//                            localRenderContext.setWorkspace(node.getSession().getWorkspace().getName());
        JCRSiteNode site = node.getResolveSite();
        localRenderContext.setSite(site);
        localRenderContext.setSiteInfo(new SiteInfo(node.getResolveSite()));
        localRenderContext.setURLGenerator(new URLGenerator(localRenderContext, r));
        try {
            return renderService.render(r, localRenderContext);
        } catch (RenderException e) {
            throw new RuntimeException(e);
        }
    }

    private String renderFile (JCRNodeWrapper node,HttpServletRequest request, HttpServletResponse response) throws RepositoryException {
        Binary binary = null;
        try {
            JCRNodeWrapper content = getContentNode(node);
            binary = content.getProperty(Constants.JCR_DATA).getBinary();
            String mimetype = content.getProperty(Constants.JCR_MIMETYPE).getString();
            String fileName = node.getProperty("j:nodename").getString();

            response.setContentType(mimetype);
            response.setHeader("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
            response.setContentLength((int) binary.getSize());
            try (InputStream is =  binary.getStream();
                 OutputStream os = response.getOutputStream()) {

                byte[] buffer = new byte[4096];
                int bytesRead;

                while ((bytesRead = is.read(buffer)) != -1) {
                    os.write(buffer, 0, bytesRead);
                }
            }
            return null;

        } catch (PathNotFoundException | IOException e) {
            LOGGER.warn("Unable to get " + Constants.JCR_DATA + " property for node {}", node.getPath());
            return "<h1>No file found</h1>";
        }
    }

    private JCRNodeWrapper getContentNode(JCRNodeWrapper n)
            throws RepositoryException {

        JCRNodeWrapper content;
        try {
            content = n.getNode(Constants.JCR_CONTENT);
        } catch (PathNotFoundException e) {
            LOGGER.warn("Cannot find " + Constants.JCR_CONTENT + " sub-node in the {} node.",
                    n.getPath());
            content = null;
        }

        return content;
    }
    //Taken from graphql-dxm-provider/src/main/java/org/jahia/modules/graphql/provider/dxm/util/ServletUtil.java

    /**
     * Unwraps request if it is instance of HttpServletRequestWrapper else returns original request
     * <p>
     * This may be necessary in some situations as Felix's ServletHandlerRequest can transform request
     * </p>
     * from:
     * <p>
     * contextPath: ""
     * servletPath: "/modules"
     * pathInfo: "/graphql"
     * requestURI: "/modules/graphql"
     * </p>
     * to:
     * <p>
     * contextPath: ""
     * servletPath: "/graphql"
     * pathInfo: null
     * requestURI: "/modules/graphql"
     * </p>
     * <p>
     * Which may lead to undesirable artifacts in urls. For example, using such a request to process outbound rewrite rules
     * will result in "/modules" suffix on context even if the context is originally empty.
     * </p>
     *
     * @param request
     * @return HttpServletRequest
     */
    public static HttpServletRequest unwrapRequest(HttpServletRequest request) {
        if (request instanceof HttpServletRequestWrapper) {
            return (HttpServletRequest) ((HttpServletRequestWrapper) request).getRequest();
        }

        return request;
    }
}
